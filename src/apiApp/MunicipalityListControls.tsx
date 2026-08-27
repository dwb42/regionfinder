import { useState, type FormEvent } from 'react'
import type { ApiMunicipalityList, ApiMunicipalityListCreateRequest, ApiMunicipalityListUpdateRequest } from '../api/contracts'

export function MunicipalityListControls({
  lists,
  activeListIds,
  suggestedColor,
  isLoading,
  error,
  onToggleActive,
  onCreate,
  onUpdate,
  onDelete,
}: {
  lists: ApiMunicipalityList[]
  activeListIds: string[]
  suggestedColor: string
  isLoading: boolean
  error: string | null
  onToggleActive: (id: string) => void
  onCreate: (input: ApiMunicipalityListCreateRequest) => Promise<ApiMunicipalityList | null>
  onUpdate: (id: string, input: ApiMunicipalityListUpdateRequest) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [colorOverride, setColorOverride] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#2563EB')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const color = colorOverride ?? suggestedColor

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()

    if (!trimmedName) {
      return
    }

    setBusyId('create')
    const created = await onCreate({ name: trimmedName, color })
    setBusyId(null)

    if (created) {
      setName('')
      setColorOverride(null)
    }
  }

  function beginEditing(list: ApiMunicipalityList) {
    setEditingId(list.id)
    setEditName(list.name)
    setEditColor(list.color)
    setConfirmDeleteId(null)
  }

  async function saveEditing(listId: string) {
    const trimmedName = editName.trim()

    if (!trimmedName) {
      return
    }

    setBusyId(listId)
    const saved = await onUpdate(listId, { name: trimmedName, color: editColor })
    setBusyId(null)

    if (saved) {
      setEditingId(null)
    }
  }

  async function confirmDelete(listId: string) {
    setBusyId(listId)
    const deleted = await onDelete(listId)
    setBusyId(null)

    if (deleted) {
      setConfirmDeleteId(null)
      setEditingId(null)
    }
  }

  return (
    <div className="municipality-list-controls">
      <form className="municipality-list-create" onSubmit={(event) => void handleCreate(event)}>
        <input
          type="text"
          value={name}
          maxLength={80}
          placeholder="Neue Liste"
          aria-label="Name der neuen Gemeindeliste"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="municipality-list-color"
          type="color"
          value={color}
          aria-label="Farbe der neuen Gemeindeliste"
          onChange={(event) => setColorOverride(event.target.value.toUpperCase())}
        />
        <button type="submit" disabled={!name.trim() || busyId === 'create'}>
          Anlegen
        </button>
      </form>

      {isLoading ? <p className="api-inline-status">Listen werden geladen …</p> : null}
      {!isLoading && lists.length === 0 ? <p className="municipality-list-empty">Noch keine Liste angelegt.</p> : null}

      <div className="municipality-list-rows">
        {lists.map((list) => (
          <div key={list.id} className="municipality-list-row">
            {editingId === list.id ? (
              <div className="municipality-list-edit">
                <input
                  type="text"
                  value={editName}
                  maxLength={80}
                  aria-label={`Name von ${list.name}`}
                  onChange={(event) => setEditName(event.target.value)}
                />
                <input
                  className="municipality-list-color"
                  type="color"
                  value={editColor}
                  aria-label={`Farbe von ${list.name}`}
                  onChange={(event) => setEditColor(event.target.value.toUpperCase())}
                />
                <div className="municipality-list-actions">
                  <button type="button" disabled={!editName.trim() || busyId === list.id} onClick={() => void saveEditing(list.id)}>
                    Speichern
                  </button>
                  <button type="button" onClick={() => setEditingId(null)}>Abbrechen</button>
                </div>
              </div>
            ) : (
              <>
                <label className="municipality-list-toggle">
                  <input
                    id={`municipality-list-active-${list.id}`}
                    type="checkbox"
                    checked={activeListIds.includes(list.id)}
                    onChange={() => onToggleActive(list.id)}
                  />
                  <span className="municipality-list-swatch" style={{ backgroundColor: list.color }} aria-hidden="true" />
                  <span className="municipality-list-name">{list.name}</span>
                  <span className="municipality-list-count">{list.municipalityCount}</span>
                </label>
                {confirmDeleteId === list.id ? (
                  <div className="municipality-list-delete-confirm">
                    <span>Liste löschen?</span>
                    <button type="button" disabled={busyId === list.id} onClick={() => void confirmDelete(list.id)}>Ja</button>
                    <button type="button" onClick={() => setConfirmDeleteId(null)}>Nein</button>
                  </div>
                ) : (
                  <div className="municipality-list-actions">
                    <button type="button" onClick={() => beginEditing(list)}>Bearbeiten</button>
                    <button type="button" onClick={() => setConfirmDeleteId(list.id)}>Löschen</button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {error ? <p className="api-inline-error">{error}</p> : null}
    </div>
  )
}
