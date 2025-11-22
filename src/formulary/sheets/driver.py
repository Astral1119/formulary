from pathlib import Path
from typing import Optional
from playwright.async_api import BrowserContext, async_playwright, Playwright, Page

class PlaywrightDriver:
    def __init__(self, headless: bool = True, user_data_dir: Optional[Path] = None):
        self.headless = headless
        self.user_data_dir = user_data_dir  # must be provided by caller now
        self._playwright: Optional[Playwright] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None

    async def start(self):
        if self._playwright is None:
            self._playwright = await async_playwright().start()
        
        self.user_data_dir.mkdir(parents=True, exist_ok=True)
        
        self._context = await self._playwright.chromium.launch_persistent_context(
            user_data_dir=str(self.user_data_dir),
            headless=self.headless,
            channel="chrome",
            args=[
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-blink-features=AutomationControlled",
            ],
            viewport={"width": 1400, "height": 900},
        )
        
        # get the first page or create one
        if self._context.pages:
            self._page = self._context.pages[0]
        else:
            self._page = await self._context.new_page()

    async def stop(self):
        if self._context:
            await self._context.close()
            self._context = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None

    @property
    def page(self) -> Page:
        if self._page is None:
            raise RuntimeError("Driver not started. Call start() first.")
        return self._page
