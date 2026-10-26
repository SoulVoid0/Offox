/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Offox: everything that could reach the internet is switched off and
// locked. Offox answers every http(s) request itself from the storage
// folders (see browser/components/offox/modules/OffoxService.sys.mjs); the
// prefs below make sure nothing else in the browser ever opens a socket.

// ---- Offox ---------------------------------------------------------------
pref("offox.storage.roots", "[]");
pref("offox.ffmpeg.path", "");
pref("offox.autoconvert", true);

// ---- Home, new tab, search -----------------------------------------------
pref("browser.startup.homepage", "https://fireline.offox/");
pref("browser.startup.page", 1);
pref("browser.startup.homepage_override.mstone", "ignore", locked);
pref("startup.homepage_welcome_url", "", locked);
pref("startup.homepage_welcome_url.additional", "", locked);
pref("startup.homepage_override_url", "", locked);
pref("browser.aboutwelcome.enabled", false, locked);
pref("browser.newtabpage.activity-stream.feeds.topsites", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.newtabpage.activity-stream.showSponsored", false, locked);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false, locked);
pref("browser.newtabpage.activity-stream.feeds.telemetry", false, locked);
pref("browser.newtabpage.activity-stream.telemetry", false, locked);
// FireLine suggestions come from your own websites (https://fireline.offox/api/suggest).
pref("browser.search.suggest.enabled", true);
// Address bar: only your websites, history, bookmarks, tabs and FireLine.
// Top sites are your own websites (OffoxService sets
// browser.newtabpage.activity-stream.default.sites) plus the ones you visit.
pref("browser.topsites.useRemoteSetting", false, locked);
pref("browser.newtabpage.activity-stream.improvesearch.topSiteSearchShortcuts", false, locked);
pref("browser.newtabpage.activity-stream.improvesearch.noDefaultSearchTile", true, locked);
pref("browser.urlbar.suggest.engines", false, locked);
pref("browser.urlbar.suggest.quickactions", false);
pref("browser.urlbar.suggest.recentsearches", false);
pref("browser.urlbar.suggest.addons", false, locked);
pref("browser.urlbar.suggest.mdn", false, locked);
pref("browser.urlbar.suggest.weather", false, locked);
pref("browser.urlbar.suggest.yelp", false, locked);
pref("browser.urlbar.suggest.amp", false, locked);
pref("browser.urlbar.suggest.wikipedia", false, locked);
pref("browser.urlbar.suggest.importantDates", false, locked);
pref("browser.urlbar.groupLabels.enabled", false);
pref("browser.urlbar.showSearchTerms.enabled", false);
pref("browser.urlbar.shortcuts.actions", false);
pref("browser.search.update", false, locked);
pref("browser.urlbar.suggest.quicksuggest.sponsored", false, locked);
pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false, locked);
pref("browser.urlbar.quicksuggest.enabled", false, locked);
pref("browser.urlbar.speculativeConnect.enabled", false, locked);
pref("browser.urlbar.suggest.trending", false, locked);
pref("browser.urlbar.trending.featureGate", false, locked);
pref("browser.urlbar.addons.featureGate", false, locked);
pref("browser.urlbar.weather.featureGate", false, locked);
pref("browser.urlbar.yelp.featureGate", false, locked);
pref("browser.urlbar.mdn.featureGate", false, locked);
pref("browser.fixup.domainsuffixwhitelist.offox", true);
pref("browser.fixup.dns_first_for_single_words", false, locked);
// Site addresses are always https://; there is no plain-http version.
pref("dom.security.https_first", true);

// ---- The network itself ----------------------------------------------------
// Anything that is not an http(s) channel (or that would slip past Offox)
// is sent to a SOCKS proxy on the discard port, which never answers.
pref("network.proxy.type", 1, locked);
pref("network.proxy.socks", "127.0.0.1", locked);
pref("network.proxy.socks_port", 9, locked);
pref("network.proxy.socks_version", 5, locked);
pref("network.proxy.socks_remote_dns", true, locked);
pref("network.proxy.socks5_remote_dns", true, locked);
pref("network.proxy.http", "", locked);
pref("network.proxy.ssl", "", locked);
pref("network.proxy.share_proxy_settings", false, locked);
pref("network.proxy.no_proxies_on", "", locked);
pref("network.proxy.allow_hijacking_localhost", true, locked);
pref("network.proxy.failover_direct", false, locked);
pref("network.trr.mode", 5, locked);
pref("network.dns.disablePrefetch", true, locked);
pref("network.dns.disablePrefetchFromHTTPS", true, locked);
pref("network.dns.upgrade_with_https_rr", false, locked);
pref("network.dns.use_https_rr_as_altsvc", false, locked);
pref("network.dns.echconfig.enabled", false, locked);
pref("network.prefetch-next", false, locked);
pref("network.http.speculative-parallel-limit", 0, locked);
pref("network.connectivity-service.enabled", false, locked);
pref("network.captive-portal-service.enabled", false, locked);
pref("captivedetect.canonicalURL", "", locked);
pref("network.http.http3.enable", false, locked);
pref("network.manage-offline-status", false, locked);
pref("media.peerconnection.enabled", false, locked);
pref("dom.push.enabled", false, locked);
pref("dom.push.connection.enabled", false, locked);
pref("dom.push.serverURL", "", locked);
pref("security.OCSP.enabled", 0, locked);
pref("security.remote_settings.crlite_filters.enabled", false, locked);
pref("security.remote_settings.intermediates.enabled", false, locked);
pref("security.certerrors.mitm.priming.enabled", false, locked);
pref("network.lna.enabled", false);

// ---- Mozilla services ------------------------------------------------------
pref("app.update.auto", false, locked);
pref("app.update.checkInstallTime", false, locked);
pref("app.normandy.enabled", false, locked);
pref("app.normandy.api_url", "", locked);
pref("app.shield.optoutstudies.enabled", false, locked);
pref("services.settings.server", "data:,", locked);
pref("services.sync.engine.addons", false);
pref("identity.fxaccounts.enabled", false, locked);
pref("toolkit.telemetry.enabled", false, locked);
pref("toolkit.telemetry.unified", false, locked);
pref("toolkit.telemetry.archive.enabled", false, locked);
pref("toolkit.telemetry.server", "data:,", locked);
pref("toolkit.telemetry.shutdownPingSender.enabled", false, locked);
pref("toolkit.telemetry.newProfilePing.enabled", false, locked);
pref("toolkit.telemetry.firstShutdownPing.enabled", false, locked);
pref("toolkit.telemetry.bhrPing.enabled", false, locked);
pref("toolkit.telemetry.updatePing.enabled", false, locked);
pref("datareporting.healthreport.uploadEnabled", false, locked);
pref("datareporting.policy.dataSubmissionEnabled", false, locked);
pref("datareporting.usage.uploadEnabled", false, locked);
pref("browser.crashReports.unsubmittedCheck.enabled", false, locked);
pref("breakpad.reportURL", "", locked);
pref("browser.safebrowsing.malware.enabled", false, locked);
pref("browser.safebrowsing.phishing.enabled", false, locked);
pref("browser.safebrowsing.downloads.enabled", false, locked);
pref("browser.safebrowsing.downloads.remote.enabled", false, locked);
pref("browser.safebrowsing.blockedURIs.enabled", false, locked);
pref("browser.safebrowsing.provider.google.updateURL", "", locked);
pref("browser.safebrowsing.provider.google4.updateURL", "", locked);
pref("browser.safebrowsing.provider.mozilla.updateURL", "", locked);
pref("extensions.update.enabled", false, locked);
pref("extensions.getAddons.cache.enabled", false, locked);
pref("extensions.systemAddon.update.enabled", false, locked);
pref("extensions.htmlaboutaddons.recommendations.enabled", false, locked);
pref("extensions.getAddons.showPane", false, locked);
pref("extensions.blocklist.enabled", false, locked);
pref("browser.discovery.enabled", false, locked);
pref("browser.contentblocking.report.lockwise.enabled", false);
pref("browser.contentblocking.report.monitor.enabled", false);
pref("browser.vpn_promo.enabled", false, locked);
pref("browser.promo.focus.enabled", false, locked);
pref("browser.preferences.moreFromMozilla", false, locked);
pref("browser.translations.enable", false, locked);
pref("browser.ml.enable", false, locked);
pref("browser.ml.chat.enabled", false, locked);
pref("browser.ml.chat.sidebar", false, locked);
pref("browser.ml.chat.menu", false, locked);
pref("browser.ml.chat.shortcuts", false, locked);
pref("browser.ml.linkPreview.enabled", false, locked);
pref("browser.smartwindow.enabled", false, locked);
pref("browser.preferences.aiControls", false, locked);
pref("browser.tabs.groups.smart.enabled", false, locked);
// Settings: the redesigned page, without the online-only sections
// (see OFFOX_HIDDEN_PANES in browser/components/preferences/preferences.js).
pref("browser.settings-redesign.enabled", true, locked);
pref("browser.shell.checkDefaultBrowser", false);
pref("browser.profiles.enabled", true);
pref("browser.region.network.url", "", locked);
pref("browser.region.update.enabled", false, locked);
pref("geo.enabled", false, locked);
pref("geo.provider.network.url", "", locked);
pref("browser.topsites.contile.enabled", false, locked);
pref("browser.newtabpage.activity-stream.discoverystream.enabled", false, locked);
pref("browser.uitour.enabled", false, locked);
pref("network.connectivity-service.IPv4.url", "", locked);
pref("network.connectivity-service.IPv6.url", "", locked);
pref("doh-rollout.disable-heuristics", true, locked);
pref("browser.send_pings", false, locked);
pref("beacon.enabled", false);
pref("privacy.resistFingerprinting.block_mozAddonManager", true);
pref("dom.security.https_only_mode_send_http_background_request", false, locked);
pref("browser.tabs.firefox-view", false);
