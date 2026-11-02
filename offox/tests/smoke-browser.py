#!/usr/bin/env python3
"""Starts a built Offox (headless, through geckodriver) and checks that it
works: about:offox, creating the default websites, serving them, www.
addresses, FireLine, the Offox Sites menu items and the trimmed Settings.
Saves screenshots for a person to look at.

    pip install selenium
    python3 offox/tests/smoke-browser.py <path to offox or offox.exe> <output folder>

geckodriver must be on the PATH (https://github.com/mozilla/geckodriver).
"""
import json
import os
import sys
import tempfile
import time

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait

binary, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
failures = []


def check(cond, message):
    print(("  ok    " if cond else "  FAIL  ") + message, flush=True)
    if not cond:
        failures.append(message)


def shot(name):
    driver.save_screenshot(os.path.join(out, name + ".png"))


def wait(predicate, timeout=60):
    def attempt(_):
        try:
            return predicate()
        except Exception:
            return False
    try:
        return WebDriverWait(driver, timeout).until(attempt)
    except TimeoutException:
        return False


def open_privileged(url):
    # Marionette refuses to navigate content to privileged about: pages.
    with driver.context(driver.CONTEXT_CHROME):
        driver.execute_script("""
          gBrowser.selectedBrowser.fixupAndLoadURIString(arguments[0], {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });""", url)
    wait(lambda: driver.current_url.startswith(url))


options = Options()
options.binary_location = binary
options.add_argument("--headless")
options.add_argument("-remote-allow-system-access")
options.add_argument("--width=1280")
options.add_argument("--height=900")
driver = webdriver.Firefox(options=options)
storage = tempfile.mkdtemp(prefix="offox-smoke-")
try:
    caps = driver.capabilities
    print("Browser:", caps.get("browserName"), caps.get("browserVersion"))

    # about:offox
    open_privileged("about:offox")
    wait(lambda: driver.execute_script("return document.body.dataset.ready == 'true'"))
    check(driver.title == "Offox settings", "about:offox opens")
    position = driver.execute_script("return getComputedStyle(document.querySelector('.nav')).position")
    check(position == "sticky", "about:offox has its stylesheet")
    shot("01-about-offox-welcome")

    # Add a storage folder: the default websites are created.
    driver.find_element(By.ID, "add-root-path").send_keys(storage)
    driver.find_element(By.CSS_SELECTOR, "#add-root-form button[type=submit]").click()
    try:
        wait(lambda: len(driver.find_elements(By.CSS_SELECTOR, "#site-list .card")) >= 7)
    except Exception:
        pass
    cards = driver.find_elements(By.CSS_SELECTOR, "#site-list .card")
    check(len(cards) == 7, f"adding a folder lists 7 default websites (got {len(cards)})")
    folders = sorted(os.listdir(storage))
    print("  storage folder:", folders)
    check("offox-storage.json" in folders and "Offddit" in folders and "OffTube" in folders,
          "the default websites are created on disk")
    shot("02-about-offox-sites")

    # Websites are served from the folder.
    driver.get("https://youtube.com/")
    wait(lambda: driver.title != "")
    check("OffTube" in driver.title, f"youtube.com is OffTube (title {driver.title!r})")
    shot("03-offtube")
    driver.get("https://www.reddit.com/")
    wait(lambda: driver.title != "")
    check(driver.current_url.startswith("https://reddit.com/"), f"www.reddit.com goes to reddit.com ({driver.current_url})")
    check("Offddit" in driver.title, "reddit.com is the notes board")
    shot("04-offddit")
    driver.get("https://wikipedia.org/")
    wait(lambda: "Offpedia" in driver.title or "Main" in driver.title, 20)
    check("Offpedia" in driver.title or "Main" in driver.title, f"wikipedia.org is Offpedia (title {driver.title!r})")
    driver.get("https://fireline.offox/search?q=offox")
    wait(lambda: len(driver.find_elements(By.CSS_SELECTOR, "a")) > 3, 20)
    check(len(driver.find_elements(By.CSS_SELECTOR, "a")) > 3, "FireLine search answers")
    shot("05-fireline-search")
    driver.get("https://not-a-site.example/")
    wait(lambda: driver.title != "")
    check("not one of your websites" in driver.page_source, "unknown addresses show the offline page")

    # Settings without the online-only sections.
    open_privileged("about:preferences")
    time.sleep(4)
    nav = driver.execute_script("""
      let ids = [...document.querySelectorAll('#categories moz-page-nav-button')]
        .filter(b => !b.hidden && b.getAttribute('slot') != 'secondary-nav' && !b.classList.contains('hidden-category'))
        .map(b => b.id);
      return { ids, offox: !!document.getElementById('offoxSitesButton') };""")
    print("  settings sections:", nav["ids"])
    check(nav["offox"], "Settings has an Offox Sites link")
    check("category-ai-features" not in nav["ids"], "Settings has no AI controls")
    check("category-more-from-mozilla" not in nav["ids"], "Settings has no More from Mozilla")
    shot("06-settings")

    # Browser window: menus, top sites and prefs (chrome context).
    with driver.context(driver.CONTEXT_CHROME):
        state = driver.execute_script("""
          let doc = document;
          let tpl = doc.getElementById('appMenu-viewCache');
          return {
            appMenu: !!(doc.getElementById('appMenu-offox-sites-button') || tpl?.content.getElementById('appMenu-offox-sites-button')),
            toolsMenu: !!doc.getElementById('menu_openOffoxSites'),
            toolbar: !!doc.getElementById('offox-sites-button'),
            topSites: Services.prefs.getStringPref('browser.newtabpage.activity-stream.default.sites', ''),
            remoteTopSites: Services.prefs.getBoolPref('browser.topsites.useRemoteSetting', true),
            proxyLocked: Services.prefs.prefIsLocked('network.proxy.type'),
          };""")
        state["engine"] = driver.execute_async_script("""
          let done = arguments[arguments.length - 1];
          let search = window.Services?.search || Services.search;
          search.init().then(() => search.getDefault())
            .then(e => done(e?.name || ''), e => done('error: ' + e));""")
        print("  window:", json.dumps(state))
        check(state["appMenu"], "the app menu has Offox Sites")
        check(state["toolsMenu"], "the Tools menu has Offox Sites")
        check(state["toolbar"], "the toolbar has the Offox Sites button")
        check("https://youtube.com/" in state["topSites"], "address bar top sites are your websites")
        check(not state["remoteTopSites"], "Firefox's default top sites are off")
        check(state["proxyLocked"], "the network settings are locked")
        check(state["engine"] == "FireLine", f"FireLine is the search engine ({state['engine']!r})")
        driver.save_screenshot(os.path.join(out, "07-window.png"))
finally:
    driver.quit()

print()
if failures:
    print(f"{len(failures)} check(s) failed:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("All smoke checks passed.")
