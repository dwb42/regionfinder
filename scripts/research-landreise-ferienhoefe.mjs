import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const outputPath = 'data/raw/places/ferienhoefe/landreise_browser_links.json'
const sources = [
  {
    sourceId: 'landreise_browser_sh',
    stateCode: 'SH',
    url: 'https://www.landreise.de/bauernhofurlaub-landurlaub/schleswig-holstein/',
  },
  {
    sourceId: 'landreise_browser_mv',
    stateCode: 'MV',
    url: 'https://www.landreise.de/bauernhofurlaub-landurlaub/mecklenburg-vorpommern/',
  },
  {
    sourceId: 'landreise_browser_ni',
    stateCode: 'NI',
    url: 'https://www.landreise.de/bauernhofurlaub-landurlaub/niedersachsen/',
  },
]

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
const records = []

for (const source of sources) {
  console.log(`loading ${source.sourceId}`)
  await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(1800)

  for (let step = 0; step < 40; step += 1) {
    const before = await exposeLinks(page)
    const button = page.getByText(/Mehr Ergebnisse laden/i).first()

    if (!(await button.isVisible().catch(() => false))) {
      break
    }

    const disabled = await button.isDisabled().catch(() => false)
    const text = await button.textContent().catch(() => '')

    if (disabled || !text || /240 von 240|104 von 104/i.test(text)) {
      break
    }

    await button.click()
    await page.waitForTimeout(1300)
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined)
    const after = await exposeLinks(page)

    if (after.length <= before.length) {
      break
    }
  }

  const links = await exposeLinks(page)
  const unique = new Map()

  for (const link of links) {
    unique.set(link.href, link)
  }

  for (const link of unique.values()) {
    records.push({
      ...source,
      detailUrl: link.href,
      listingText: link.text,
    })
  }

  console.log(`${source.sourceId}: ${unique.size} links`)
}

await browser.close()
await writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2), 'utf8')
console.log(JSON.stringify({ outputPath, count: records.length }))

async function exposeLinks(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/expose/"]'))
      .map((anchor) => ({
        href: anchor.href,
        text: anchor.textContent?.trim().replace(/\s+/g, ' ') ?? '',
      }))
      .filter((link) => link.href),
  )
}
