from typing import Dict, List, Optional, Set
import logging
from .driver import PlaywrightDriver
from ..domain.models import Function
import asyncio
from playwright.async_api import Page

logger = logging.getLogger(__name__)

class SheetClient:
    def __init__(self, driver: PlaywrightDriver, url: str):
        self.driver = driver
        self.url = url

    @property
    def page(self) -> Page:
        return self.driver.page

    async def connect(self):
        await self.driver.start()
        await self.page.goto(self.url)
        # dismiss "Got it" if present
        try:
            button = self.page.get_by_role("button", name="Got it")
            if await button.count() > 0:
                await button.first.click()
        except Exception:
            pass

    async def close(self):
        await self.driver.stop()

    async def open_named_functions_sidebar(self):
        # navigate to Data > Named functions

        data_menu = self.page.get_by_role("menuitem", name="Data")
        await data_menu.click()
        await self.page.keyboard.press("k") # shortcut for named functions
        
        # wait for sidebar to appear
        # try to detect if empty state first to avoid long timeout
        try:
            # quick check for empty state (200ms)
            await self.page.wait_for_selector(".waffle-named-formulas-sidebar-list-view-zero-state-promo-wrapper", timeout=200)
            # empty state found immediately
            return
        except Exception:
            pass
        
        # not empty state, wait for list view
        try:
            await self.page.wait_for_selector(".waffle-named-formulas-sidebar-list-view-card", timeout=2000)
        except Exception:
            # might still be empty state or loading - wait a bit for footer
            try:
                await self.page.wait_for_selector(".waffle-named-formulas-sidebar-list-view-footer-add-named-formula-button", timeout=1000)
            except Exception:
                # give up, might be an issue
                pass

    async def get_named_functions(self) -> Dict[str, Function]:
        await self.open_named_functions_sidebar()
        
        functions = {}
        
        # check for empty state
        empty_state = await self.page.query_selector('.waffle-named-formulas-sidebar-list-view-zero-state-promo-wrapper')
        if empty_state and await empty_state.is_visible():
            return {}

        rows = await self.page.query_selector_all('.waffle-named-formulas-sidebar-list-view-card')
        
        # iterate through rows. note: DOM might change if we interact, but for reading it should be fine
        # however, to get details we need to click "Edit" which changes the view
        # so we need to go back and forth
        
        # first, collect names to iterate over
        names = []
        for row in rows:
            name_el = await row.query_selector('.waffle-named-formulas-sidebar-list-view-card-function-signature')
            if name_el:
                text = await name_el.inner_text()
                names.append(text.split('(')[0].strip())

        for name in names:
            func = await self._get_function_details(name)
            if func:
                functions[name] = func
            
            # go back to list view if needed (usually clicking Back button)
            # but _get_function_details should handle returning to list or we re-open sidebar
            await self.open_named_functions_sidebar()

        return functions

    async def _get_function_details(self, name: str) -> Optional[Function]:
        # find row for name
        rows = await self.page.query_selector_all('.waffle-named-formulas-sidebar-list-view-card')
        target_row = None
        argument_names = []
        
        for row in rows:
            name_el = await row.query_selector('.waffle-named-formulas-sidebar-list-view-card-function-signature')
            if name_el:
                name_text = await name_el.inner_text()
                # parse name and arguments from signature: "MY_FUNC(arg1, arg2)"
                parts = name_text.split('(')
                func_name = parts[0].strip()
                
                if func_name == name:
                    target_row = row
                    # extract argument names from signature if present
                    if len(parts) > 1:
                        # remove closing ')' and split by comma
                        args_str = parts[1].rstrip(')')
                        if args_str.strip():
                            argument_names = [arg.strip() for arg in args_str.split(',') if arg.strip()]
                    break
        
        if not target_row:
            return None

        # click Edit
        docs_icon = await target_row.query_selector('.docs-icon')
        await docs_icon.click()
        
        # wait for menu
        await self.page.wait_for_selector('.waffle-named-formulas-sidebar-list-view-card-action-menu-item')
        
        # click Edit
        await self.page.locator(".waffle-named-formulas-sidebar-list-view-card-action-menu-item-action-name").filter(has_text="Edit").click()
        
        # wait for edit form to load
        await self.page.wait_for_timeout(500)
        
        # extract details
        # description
        desc_input = self.page.locator("div[aria-label='Enter formula description']").filter(visible=True)
        description = await desc_input.inner_text() if await desc_input.count() > 0 else "" 
        if not description:
             # legacy used inner_text on specific inputs
             inputs = await self.page.query_selector_all('.waffle-named-formulas-expandable-input')
             # filter for visible ones? query_selector_all returns handles.
             # let's rely on the locator above mostly.
             if await desc_input.count() > 0:
                 description = await desc_input.inner_text()

        # definition
        def_input = self.page.locator("div[aria-label='= Write formula here']").filter(visible=True)
        definition = await def_input.inner_text() if await def_input.count() > 0 else ""
        if not definition and await def_input.count() > 0:
             definition = await def_input.inner_text()

        # arguments - Extract using names from signature (Legacy Logic)
        arguments = argument_names # use the names we parsed from signature
        argument_metadata = {}
        
        try:
            if argument_names:
                # get all description and example inputs
                # note: This relies on the order matching the argument names, which is how Sheets UI works
                desc_inputs = await self.page.query_selector_all('.waffle-named-formulas-sidebar-create-step-b-argument-description-field-input')
                example_inputs = await self.page.query_selector_all('.waffle-named-formulas-sidebar-create-step-b-argument-usage-example-field-input')
                
                # zip them together
                for i, arg_name in enumerate(argument_names):
                    arg_desc = ""
                    arg_example = ""
                    
                    if i < len(desc_inputs):
                        arg_desc = await desc_inputs[i].input_value()
                    
                    if i < len(example_inputs):
                        arg_example = await example_inputs[i].input_value()
                    
                    from ..domain.models import ArgumentMetadata
                    argument_metadata[arg_name] = ArgumentMetadata(
                        description=arg_desc if arg_desc else "No description provided.",
                        example=arg_example if arg_example else "No example provided."
                    )
        except Exception as e:
            # if argument extraction fails, just return what we have
            pass
        
        # cancel to go back
        await self.page.get_by_role("button", name="Cancel").click()
        
        return Function(
            name=name,
            definition=definition,
            description=description,
            arguments=arguments,
            argument_metadata=argument_metadata
        )

    async def create_function(self, function: Function):
        await self.open_named_functions_sidebar()
        
        # click Add new button using wait and press Enter (legacy approach)
        button = await self.page.wait_for_selector('.waffle-named-formulas-sidebar-list-view-footer-add-named-formula-button')
        await button.press('Enter')
        
        # wait for create form to appear
        await self.page.wait_for_timeout(500)
        
        # fill Name
        name_input = await self.page.wait_for_selector(".waffle-named-formulas-sidebar-create-step-a-function-name-field-input")
        await name_input.fill(function.name)
        await self.page.wait_for_timeout(100)
        
        # fill Description
        desc_inputs = await self.page.query_selector_all("div[aria-label='Enter formula description']")
        if desc_inputs:
            # find visible one
            for inp in desc_inputs:
                if await inp.is_visible():
                    await inp.fill(function.description or "")
                    await self.page.wait_for_timeout(100)
                    break
        
        # add Arguments
        for arg in function.arguments:
            arg_input = await self.page.query_selector("input.waffle-named-formulas-sidebar-create-step-a-new-argument-name-field-input")
            if arg_input:
                await arg_input.fill(arg)
                await arg_input.press("Enter")
                await self.page.wait_for_timeout(200)  # wait for argument to be added

        # fill Definition
        def_inputs = await self.page.query_selector_all("div[aria-label='= Write formula here']")
        if def_inputs:
            for inp in def_inputs:
                if await inp.is_visible():
                    try:
                        await inp.fill(function.definition)
                    except Exception as e:
                        logger.warning(f"fill failed for definition, trying evaluate: {e}")
                        try:
                            await inp.evaluate("(el, val) => el.innerText = val", function.definition)
                        except Exception as eval_error:
                            logger.error(f"both fill and evaluate failed: {eval_error}")
                    await self.page.wait_for_timeout(100)
                    break

        # click Next using press Enter
        button = await self.page.query_selector('.waffle-named-formulas-sidebar-create-step-a-next-button')
        if button:
            await button.press('Enter')
            # wait for UI transition
            await self.page.wait_for_timeout(500)
        
        # fill argument details (Step B)
        if function.argument_metadata:
            for arg_name, metadata in function.argument_metadata.items():
                # use argument-specific selectors as in legacy code
                desc_selector = f"input[aria-label='Enter description for argument {arg_name}']"
                example_selector = f"input[aria-label='Enter example for argument {arg_name}']"
                
                # fill description
                desc_input = await self.page.query_selector(desc_selector)
                if desc_input and await desc_input.is_visible():
                    await desc_input.fill(metadata.description)
                    await self.page.wait_for_timeout(100)
                
                # fill example
                example_input = await self.page.query_selector(example_selector)
                if example_input and await example_input.is_visible():
                    await example_input.fill(metadata.example)
                    await self.page.wait_for_timeout(100)
        
        # click Create using press Enter
        button = await self.page.query_selector('.waffle-named-formulas-sidebar-create-step-b-create-button')
        if button:
            await button.press('Enter')

        # wait for function creation to complete
        # the form should close and return to list view
        await self.page.wait_for_timeout(1000)
        
        # wait for the list view to reappear (confirms creation completed)
        try:
            await self.page.wait_for_selector('.waffle-named-formulas-sidebar-list-view-footer-add-named-formula-button', state="visible", timeout=3000)
        except Exception as e:
            # if we can't find the add button, still continue - function might have been created
            logger.debug(f"could not confirm function creation via add button: {e}")
            pass

    async def delete_function(self, name: str):
        await self.open_named_functions_sidebar()
        
        #Find function card
        rows = await self.page.query_selector_all('.waffle-named-formulas-sidebar-list-view-card')
        for row in rows:
            name_el = await row.query_selector('.waffle-named-formulas-sidebar-list-view-card-function-signature')
            if name_el:
                text = await name_el.inner_text()
                if text.startswith(name):
                    # click menu
                    menu_btn = await row.query_selector('.waffle-named-formulas-sidebar-list-view-card-action-menu-button')
                    if menu_btn:
                        await menu_btn.click()
                        await self.page.wait_for_timeout(800)  # increased from 500ms
                        
                        # click Remove
                        remove_actions = await self.page.query_selector_all('.waffle-named-formulas-sidebar-list-view-card-action-menu-item-action-name')
                        for action in remove_actions:
                            action_text = await action.inner_text()
                            if action_text == 'Remove':
                                await action.click()
                                # wait for deletion to complete and UI to update
                                await self.page.wait_for_timeout(1500)  # increased from 1000ms
                                
                                # confirmation wait - ensure function is gone from list
                                await self.page.wait_for_timeout(1000)  # increased from 500ms
                                
                                # verify deletion by checking if function still exists
                                rows_after = await self.page.query_selector_all('.waffle-named-formulas-sidebar-list-view-card')
                                for check_row in rows_after:
                                    check_el = await check_row.query_selector('.waffle-named-formulas-sidebar-list-view-card-function-signature')
                                    if check_el:
                                        check_text = await check_el.inner_text()
                                        if check_text.startswith(name):
                                            # still there, wait a bit more
                                            await self.page.wait_for_timeout(1000)
                                            break
                                return

    async def update_function(self, function: Function):
        """Update an existing named function without breaking dependencies."""
        await self.open_named_functions_sidebar()
        
        # find the target function row
        rows = await self.page.query_selector_all('.waffle-named-formulas-sidebar-list-view-card')
        target_row = None
        
        for row in rows:
            name_el = await row.query_selector('.waffle-named-formulas-sidebar-list-view-card-function-signature')
            if name_el:
                name_text = await name_el.inner_text()
                if name_text.startswith(function.name):
                    target_row = row
                    break
        
        if not target_row:
            # function doesn't exist, create it instead
            await self.create_function(function)
            return
        
        # open menu and click Edit
        docs_icon = await target_row.query_selector('.docs-icon')
        if docs_icon:
            await docs_icon.click()
            await self.page.wait_for_timeout(300)
            
            # find and click Edit option
            actions = await self.page.query_selector_all(
                '.waffle-named-formulas-sidebar-list-view-card-action-menu-item'
            )
            for action in actions:
                action_text = await action.inner_text()
                if action_text.strip() == "Edit":
                    await action.click()
                    break
            
            # wait for edit dialog
            await self.page.wait_for_timeout(800)
            
            # update description
            desc_inputs = await self.page.query_selector_all("div[aria-label='Enter formula description']")
            if desc_inputs:
                for inp in desc_inputs:
                    if await inp.is_visible():
                        await inp.fill(function.description or "")
                        await self.page.wait_for_timeout(100)
                        break
            
            # update definition
            def_inputs = await self.page.query_selector_all("div[aria-label='= Write formula here']")
            if def_inputs:
                for inp in def_inputs:
                    if await inp.is_visible():
                        try:
                            await inp.fill(function.definition)
                        except Exception as e:
                            logger.warning(f"fill failed for definition, trying evaluate: {e}")
                            try:
                                await inp.evaluate("(el, val) => el.innerText = val", function.definition)
                            except Exception as eval_error:
                                logger.error(f"both fill and evaluate failed: {eval_error}")
                        await self.page.wait_for_timeout(100)
                        break
            
            # click Next
            button = await self.page.query_selector(
                '.waffle-named-formulas-sidebar-create-step-a-next-button:visible'
            )
            if button:
                await button.press('Enter')
                await self.page.wait_for_timeout(500)
            
            # update argument details (Step B)
            if function.argument_metadata:
                for arg_name, metadata in function.argument_metadata.items():
                    desc_selector = f"input[aria-label='Enter description for argument {arg_name}']"
                    example_selector = f"input[aria-label='Enter example for argument {arg_name}']"
                    
                    desc_input = await self.page.query_selector(desc_selector)
                    if desc_input and await desc_input.is_visible():
                        await desc_input.fill(metadata.description)
                        await self.page.wait_for_timeout(100)
                    
                    example_input = await self.page.query_selector(example_selector)
                    if example_input and await example_input.is_visible():
                        await example_input.fill(metadata.example)
                        await self.page.wait_for_timeout(100)
            
            # click Save
            save_button = await self.page.query_selector('.waffle-named-formulas-sidebar-create-step-b-create-button:visible')
            if save_button:
                await save_button.press('Enter')
                await self.page.wait_for_timeout(1000)
                
                # wait for list view to reappear
                try:
                    await self.page.wait_for_selector('.waffle-named-formulas-sidebar-list-view-footer-add-named-formula-button', state="visible", timeout=3000)
                except Exception as e:
                    logger.debug(f"could not confirm update via add button: {e}")
                    pass
