from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Navigate to the login page (it redirects to login if not authenticated)
    page.goto("http://localhost:5173/login")

    # Fill in login form (assuming Test User created above)
    page.fill("input[name='email']", "test@example.com")
    page.fill("input[name='password']", "password")
    page.click("button[type='submit']")

    # Wait for navigation to dashboard
    page.wait_for_url("http://localhost:5173/")

    # Wait for the empty state to appear
    # The empty state should have "No groups yet" text
    try:
        page.wait_for_selector("text=No groups yet", timeout=5000)
    except:
        print("Could not find 'No groups yet'. Maybe groups exist?")
        # If groups exist, we can't test the empty state easily without creating a new user or deleting groups.
        # But we just created a new user, so it should be empty.
        page.screenshot(path="verification/dashboard_debug.png")
        raise

    # Check for the new "Create Group" button in the empty state
    create_button = page.get_by_role("button", name="Create Group")

    # Take a screenshot
    page.screenshot(path="verification/dashboard_empty_state.png")

    # Verify the button is visible
    if create_button.is_visible():
        print("SUCCESS: Create Group button is visible in empty state.")
    else:
        print("FAILURE: Create Group button is NOT visible.")

    # Also verify the sidebar buttons have aria-labels (we can't easily see this in screenshot but can check attributes)
    # Mobile view test
    page.set_viewport_size({"width": 375, "height": 667})
    page.wait_for_timeout(500) # Wait for resize

    # Open sidebar button
    open_btn = page.locator("button[aria-label='Open sidebar']")
    if open_btn.count() > 0:
        print("SUCCESS: Open sidebar button has correct aria-label.")
    else:
        print("FAILURE: Open sidebar button missing or incorrect aria-label.")

    # Open the sidebar to check close button
    if open_btn.count() > 0:
        open_btn.first.click()
        page.wait_for_timeout(500) # Wait for animation

        close_btn = page.locator("button[aria-label='Close sidebar']")
        if close_btn.count() > 0:
            print("SUCCESS: Close sidebar button has correct aria-label.")
        else:
            print("FAILURE: Close sidebar button missing or incorrect aria-label.")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
