/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This module exports a provider that offers about pages.
 */

import {
  UrlbarProvider,
  UrlbarUtils,
} from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AboutPagesUtils: "resource://gre/modules/AboutPagesUtils.sys.mjs",
  UrlbarResult: "chrome://browser/content/urlbar/UrlbarResult.mjs",
});

/**
 * Class used to create the provider.
 */
export class UrlbarProviderAboutPages extends UrlbarProvider {
  /**
   * @returns {Values<typeof UrlbarUtils.PROVIDER_TYPE>}
   */
  get type() {
    return UrlbarUtils.PROVIDER_TYPE.PROFILE;
  }

  /**
   * Whether this provider should be invoked for the given context.
   * If this method returns false, the providers manager won't start a query
   * with this provider, to save on resources.
   *
   * @param {UrlbarQueryContext} queryContext The query context object
   */
  async isActive(queryContext) {
    return queryContext.trimmedLowerCaseSearchString.startsWith("about:");
  }

  /**
   * Starts querying.
   *
   * @param {UrlbarQueryContext} queryContext
   * @param {(provider: UrlbarProvider, result: UrlbarResult) => void} addCallback
   *   Callback invoked by the provider to add a new result.
   */
  startQuery(queryContext, addCallback) {
    let searchString = queryContext.trimmedLowerCaseSearchString;
    // Offox: list the Offox settings page first, so it is not cut off by the
    // result limit.
    let aboutUrls = [...lazy.AboutPagesUtils.visibleAboutUrls].sort(
      (a, b) => (b == "about:offox") - (a == "about:offox")
    );
    for (const aboutUrl of aboutUrls) {
      if (aboutUrl.startsWith(searchString)) {
        let result = new lazy.UrlbarResult({
          type: UrlbarUtils.RESULT_TYPE.URL,
          source: UrlbarUtils.RESULT_SOURCE.OTHER_LOCAL,
          payload: {
            title: aboutUrl == "about:offox" ? "Offox Sites" : aboutUrl,
            url: aboutUrl,
            icon: UrlbarUtils.getIconForUrl(aboutUrl),
          },
          highlights: {
            title: UrlbarUtils.HIGHLIGHT.TYPED,
            url: UrlbarUtils.HIGHLIGHT.TYPED,
          },
        });
        addCallback(this, result);
      }
    }
  }
}
