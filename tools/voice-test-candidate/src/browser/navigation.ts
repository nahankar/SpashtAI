import type { Page } from 'playwright'
import { productUrl, type RunConfig } from '../config.js'

/** Enter organizations through the real workspace picker; never inject application state. */
export async function navigateProduct(page: Page, cfg: Pick<RunConfig, 'targetUrl' | 'workspace'>, path: string) {
  if (!cfg.workspace) { await page.goto(productUrl(cfg, path)); return }
  const home = `/w/${cfg.workspace}`
  if (!new URL(page.url()).pathname.startsWith(`${home}/`) && new URL(page.url()).pathname !== home) {
    await page.goto(new URL('/workspaces', cfg.targetUrl).toString())
    await page.locator(`a[href=${JSON.stringify(home)}]`).first().click({ timeout: 15000 })
  }
  const destination = new URL(productUrl(cfg, path))
  const exact = page.locator(`a[href=${JSON.stringify(destination.pathname + destination.search)}]`).first()
  const primary = page.locator(`a[href=${JSON.stringify(destination.pathname)}]`).first()
  await page.locator(`a[href=${JSON.stringify(destination.pathname + destination.search)}], a[href=${JSON.stringify(destination.pathname)}]`).first().waitFor({ timeout: 20000 })
  if (await exact.count()) await exact.click()
  else if (await primary.count()) await primary.click()
  else throw new Error(`No normal UI link to ${destination.pathname}; workspace navigation blocked`)
  await page.waitForURL(url => url.pathname === destination.pathname, { timeout: 15000 })
}
