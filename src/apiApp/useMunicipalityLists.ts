import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ApiMunicipalityList,
  ApiMunicipalityListCreateRequest,
  ApiMunicipalityListUpdateRequest,
} from '../api/contracts'
import {
  addMunicipalityToList,
  createMunicipalityList,
  deleteMunicipalityList,
  fetchMunicipalityListMemberships,
  fetchMunicipalityLists,
  removeMunicipalityFromList,
  updateMunicipalityList,
} from '../data/api'

const activeListsStorageKey = 'regionfinder.municipality-lists.active.v1'

export const municipalityListPalette = [
  '#2563EB',
  '#DC2626',
  '#16A34A',
  '#9333EA',
  '#EA580C',
  '#0891B2',
  '#BE123C',
  '#4F46E5',
]

export function suggestedMunicipalityListColor(lists: ApiMunicipalityList[]): string {
  const usedColors = new Set(lists.map((list) => list.color.toUpperCase()))
  return municipalityListPalette.find((color) => !usedColors.has(color)) ?? municipalityListPalette[lists.length % municipalityListPalette.length]
}

export function useMunicipalityLists(selectedOfficialKey: string | null) {
  const [lists, setLists] = useState<ApiMunicipalityList[]>([])
  const [activeListIds, setActiveListIds] = useState<string[]>(readActiveListIds)
  const [membershipListIds, setMembershipListIds] = useState<string[]>([])
  const [membershipLoadedOfficialKey, setMembershipLoadedOfficialKey] = useState<string | null>(null)
  const [pendingMembershipListIds, setPendingMembershipListIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [membershipError, setMembershipError] = useState<string | null>(null)

  const loadLists = useCallback(async () => {
    try {
      const nextLists = await fetchMunicipalityLists()
      setLists(sortLists(nextLists))
      const knownIds = new Set(nextLists.map((list) => list.id))
      setActiveListIds((current) => {
        const next = current.filter((id) => knownIds.has(id))
        persistActiveListIds(next)
        return arraysEqual(current, next) ? current : next
      })
      setError(null)
      return nextLists
    } catch (loadError) {
      setError(errorMessage(loadError))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void fetchMunicipalityLists()
      .then((nextLists) => {
        if (cancelled) {
          return
        }

        setLists(sortLists(nextLists))
        const knownIds = new Set(nextLists.map((list) => list.id))
        setActiveListIds((current) => {
          const next = current.filter((id) => knownIds.has(id))
          persistActiveListIds(next)
          return arraysEqual(current, next) ? current : next
        })
        setError(null)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(errorMessage(loadError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedOfficialKey) {
      return
    }

    let cancelled = false

    void fetchMunicipalityListMemberships(selectedOfficialKey)
      .then((memberships) => {
        if (!cancelled) {
          setMembershipListIds(memberships.listIds)
          setMembershipLoadedOfficialKey(selectedOfficialKey)
          setMembershipError(null)
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setMembershipListIds([])
          setMembershipLoadedOfficialKey(selectedOfficialKey)
          setMembershipError(errorMessage(loadError))
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedOfficialKey])

  const activeLists = useMemo(
    () => activeListIds.map((id) => lists.find((list) => list.id === id)).filter((list): list is ApiMunicipalityList => Boolean(list)),
    [activeListIds, lists],
  )
  const isMembershipLoading = Boolean(
    selectedOfficialKey && membershipLoadedOfficialKey !== selectedOfficialKey,
  )

  const toggleActiveList = useCallback((id: string) => {
    setActiveListIds((current) => {
      const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
      persistActiveListIds(next)
      return next
    })
  }, [])

  const createList = useCallback(async (input: ApiMunicipalityListCreateRequest) => {
    try {
      const created = await createMunicipalityList(input)
      setLists((current) => sortLists([...current, created]))
      setError(null)
      return created
    } catch (createError) {
      setError(errorMessage(createError))
      return null
    }
  }, [])

  const updateList = useCallback(async (id: string, input: ApiMunicipalityListUpdateRequest) => {
    try {
      const updated = await updateMunicipalityList(id, input)
      setLists((current) => sortLists(current.map((list) => (list.id === id ? updated : list))))
      setError(null)
      return true
    } catch (updateError) {
      setError(errorMessage(updateError))
      return false
    }
  }, [])

  const deleteList = useCallback(async (id: string) => {
    try {
      await deleteMunicipalityList(id)
      setLists((current) => current.filter((list) => list.id !== id))
      setActiveListIds((current) => {
        const next = current.filter((entry) => entry !== id)
        persistActiveListIds(next)
        return next
      })
      setMembershipListIds((current) => current.filter((entry) => entry !== id))
      setError(null)
      return true
    } catch (deleteError) {
      setError(errorMessage(deleteError))
      return false
    }
  }, [])

  const setMembership = useCallback(
    async (listId: string, belongsToList: boolean) => {
      if (!selectedOfficialKey) {
        return false
      }

      setPendingMembershipListIds((current) => [...current, listId])
      setMembershipError(null)

      try {
        if (belongsToList) {
          await addMunicipalityToList(listId, selectedOfficialKey)
        } else {
          await removeMunicipalityFromList(listId, selectedOfficialKey)
        }

        setMembershipListIds((current) =>
          belongsToList
            ? Array.from(new Set([...current, listId]))
            : current.filter((entry) => entry !== listId),
        )
        await loadLists()
        return true
      } catch (membershipMutationError) {
        setMembershipError(errorMessage(membershipMutationError))
        return false
      } finally {
        setPendingMembershipListIds((current) => current.filter((entry) => entry !== listId))
      }
    },
    [loadLists, selectedOfficialKey],
  )

  return {
    lists,
    activeListIds,
    activeLists,
    membershipListIds,
    pendingMembershipListIds,
    isLoading,
    isMembershipLoading,
    error,
    membershipError: isMembershipLoading ? null : membershipError,
    suggestedColor: suggestedMunicipalityListColor(lists),
    toggleActiveList,
    createList,
    updateList,
    deleteList,
    setMembership,
  }
}

function readActiveListIds(): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const stored = JSON.parse(window.localStorage.getItem(activeListsStorageKey) ?? '[]')
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function persistActiveListIds(ids: string[]) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(activeListsStorageKey, JSON.stringify(ids))
  } catch {
    // Storage can be unavailable in privacy modes and non-browser test environments.
  }
}

function sortLists(lists: ApiMunicipalityList[]): ApiMunicipalityList[] {
  return [...lists].sort((left, right) => left.name.localeCompare(right.name, 'de'))
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
