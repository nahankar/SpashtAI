import { it, expect } from 'vitest'
import { chromium } from 'playwright'
import { navigateProduct } from '../src/browser/navigation.js'

it('waits for organization links after using the real picker, without full navigation into an org', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    let requests = 0
    await page.route('http://localhost:59999/**', async route => {
      requests++
      await route.fulfill({ contentType: 'text/html', body: `<a id="open" href="/w/northwind">Open</a><script>
        document.querySelector('#open').addEventListener('click', event => {
          event.preventDefault(); history.pushState({}, '', '/w/northwind');
          setTimeout(() => {
            const link = document.createElement('a'); link.href='/w/northwind/interviews'; link.textContent='Interviews';
            link.addEventListener('click', event => { event.preventDefault(); history.pushState({}, '', link.href) });
            document.body.replaceChildren(link);
          }, 100);
        });
      </script>` })
    })
    await navigateProduct(page, { targetUrl: 'http://localhost:59999', workspace: 'northwind' }, '/interviews')
    expect(new URL(page.url()).pathname).toBe('/w/northwind/interviews')
    expect(requests).toBe(1)
  } finally { await browser.close() }
})
