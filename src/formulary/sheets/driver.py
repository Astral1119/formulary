from pathlib import Path
from typing import Optional
from playwright.async_api import BrowserContext, async_playwright, Playwright, Page

class PlaywrightDriver:
    def __init__(
        self, 
        headless: bool = True, 
        user_data_dir: Optional[Path] = None,
        user_agent: Optional[str] = None,
        cookies: Optional[list] = None
    ):
        self.headless = headless
        self.user_data_dir = user_data_dir  # must be provided by caller now
        self.user_agent = user_agent
        self.cookies = cookies
        self._playwright: Optional[Playwright] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None

    async def start(self):
        if self._playwright is None:
            self._playwright = await async_playwright().start()
        
        self.user_data_dir.mkdir(parents=True, exist_ok=True)
        
        # use chromium browser
        self._context = await self._playwright.chromium.launch_persistent_context(
            user_data_dir=str(self.user_data_dir),
            headless=self.headless,
            user_agent=self.user_agent,
            args=[
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-blink-features=AutomationControlled",
                "--password-store=basic",
                "--use-mock-keychain",
            ],
            viewport={"width": 1400, "height": 900},
        )
        
        if self.cookies:
            await self._context.add_cookies(self.cookies)
        
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

    async def get_cookies(self):
        """get all cookies from current context."""
        if not self._context:
            return []
        return await self._context.cookies()
