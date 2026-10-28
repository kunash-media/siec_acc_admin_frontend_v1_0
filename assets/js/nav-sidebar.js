/**
 * nav-sidebar.js
 * Loads partials/nav-sidebar.html into every admin page and wires up
 * all interactions (collapse/expand, mobile off-canvas, profile menu,
 * logout confirmation overlay, active-link highlighting).
 *

* Login uses http-only cookies set by the backend (admin_token,
 * refresh_token), so the browser handles the token automatically as
 * long as every request uses `credentials: "include"`. JS never reads
 * or stores the token itself — only the non-sensitive admin info
 * (role, mobile, adminId) returned in the login response body is
 * cached in localStorage, purely for showing who's logged in.
 *
 * Usage (bottom of each admin page, right before </body>):
 *   <script src="assets/js/nav-sidebar.js"></script>
 *   <script>
 *     NavSidebar.init({
 *       basePath: "",              // relative path prefix to project root
 *       activePage: "dashboard",   // matches data-page on a sidebar link
 *       pageTitle: "Dashboard",    // shown in the top bar
 *     });
 *   </script>
 *
 * NavSidebar.init() now enforces login: if no admin session is cached
 * locally, it redirects to admin-login.html before rendering anything.
 * This is a UX guard only, not real security — the actual gate is the
 * http-only cookie enforced server-side once the JWT filter is applied
 * to /api/project routes.
 *
 * On the login page itself, include this script but do NOT call
 * NavSidebar.init() — just use window.Auth.login(...) directly.
 *
 * IMPORTANT (anti-flicker): pair this with the tiny inline script that
 * must sit in <head>, BEFORE any stylesheet — see snippet at the
 * bottom of this file / admin-template.html. That inline script reads
 * the collapsed state from localStorage and applies it to <html>
 * synchronously, so there is zero layout jump on first paint.
 */

(function (window, document) {
  "use strict";

  var STORAGE_KEY = "sidebarCollapsed";
  var AUTH_STORAGE_KEY = "adminAuth";
  var PERMS_STORAGE_KEY = "adminPerms";   // UX cache only; /me overwrites it on every page load

     // API field name -> localStorage key name
  var ORG_STORAGE_KEYS = {
    companyName: "companyName",
    legalName: "legalName",
    organizationId: "siec_organization_id",
  };

  // ---- API config ----
  var API_BASE_URL = "http://localhost:9093";
  var LOGIN_URL = API_BASE_URL + "/api/admin/auth/login";
  var LOGOUT_URL = API_BASE_URL + "/api/admin/auth/logout";
  var ORG_URL = API_BASE_URL + "/api/organization/get-org";
  var ME_URL = API_BASE_URL + "/api/admin/auth/me";

  // The server identifies the admin from the http-only cookie (permissions + activity log).
  // Applied once here so module pages don't each need credentials: "include".
  (function () {
    if (window.__siecFetchPatched) return;
    window.__siecFetchPatched = true;
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      if (typeof input === "string" && input.indexOf(API_BASE_URL) === 0 && (!init || init.credentials === undefined)) {
        init = Object.assign({}, init, { credentials: "include" });
      }
      return nativeFetch.call(window, input, init);
    };
  })();

  /* ====================================================================
   * Auth — login/logout/session module
   * ==================================================================== */
  var Auth = {
    /**
     * Calls the real login API. On success, caches the non-sensitive
     * admin info (role, mobile, adminId) in localStorage and resolves
     * with it. The actual admin_token/refresh_token cookies are set by
     * the backend as http-only — this code never touches them directly,
     * `credentials: "include"` just tells the browser to store/send them.
     */
    login: function (mobile, password) {
      return fetch(LOGIN_URL, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: mobile, password: password }),
      }).then(function (response) {
        if (response.ok) return response.json();
        return response.json()
          .catch(function () {
            throw new Error("Login failed with status " + response.status);
          })
          .then(function (errorBody) {
            throw new Error(errorBody.message || "Invalid mobile number or password.");
          });
          }).then(function (adminInfo) {
        Auth._storeAdmin(adminInfo);
        // Org fetch failure should never block login.
        return Auth.fetchAndStoreOrg()
          .catch(function (err) {
            console.warn("[auth] org fetch failed (continuing login):", err);
          })
          
          .then(function () {
            return Auth.refreshPerms();
          })
          .then(function () {
            return adminInfo;
          });
      });
    },

    /**
     * Fetches organization details and saves each field as its own
     * localStorage key (same key name as the field name).
     */
    fetchAndStoreOrg: function () {
      return fetch(ORG_URL, {
        method: "GET",
        credentials: "include",
      }).then(function (response) {
        if (!response.ok) {
          throw new Error("Org fetch failed with status " + response.status);
        }
        return response.json();
      }).then(function (org) {
              Auth._storeOrg(org);
        return org;
      });
    },

    /**
     * Verifies the http-only cookie session against the server.
     * Resolves true  -> session valid (or server unreachable / 5xx: don't log out)
     * Resolves false -> server explicitly rejected the cookie (401/403)
     * Also refreshes the cached org keys when the call succeeds.
     */
       verifySession: function () {
      return fetch(ME_URL, {
        method: "GET",
        credentials: "include",
      }).then(function (response) {
        if (response.status === 401 || response.status === 403) return false;
        if (response.redirected) return false; // bounced to a login page
        if (response.ok) {
          return response.json()
            .then(function (admin) {
              // Cookie is valid: rebuild local cache from server truth.

              Auth._storeAdmin(admin);
              Auth._storePerms(admin.permissions);
              return Auth.fetchAndStoreOrg()
                .catch(function () { /* org failure shouldn't affect session */ })
                .then(function () { return true; });
            })
            .catch(function () { return true; });
        }
        return true;
      }).catch(function (err) {
        console.warn("[auth] session check failed (network), keeping session:", err);
        return true;
      });
    },
    
    /**
     * Attempts to invalidate the session server-side, then always clears
     * local state and redirects to login — even if the server call fails,
     * so a dead/missing logout endpoint never traps the admin on the page.
     */
    logout: function () {
      fetch(LOGOUT_URL, { method: "POST", credentials: "include" })
        .catch(function (err) {
          console.warn("[auth] logout endpoint call failed (continuing with local logout):", err);
        })
        .finally(function () {
          Auth._clearAdmin();
          window.location.href = Auth._loginPath();
        });
    },

    getStoredAdmin: function () {
      try {
        var raw = localStorage.getItem(AUTH_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    isLoggedIn: function () {
      return !!Auth.getStoredAdmin();
    },

    /**
     * Client-side convenience guard only — redirects to login if there's
     * no cached session. Does not (and cannot) verify the http-only
     * cookie itself; real enforcement happens server-side.
     */
    requireAuth: function () {
      if (!Auth.isLoggedIn()) {
        window.location.href = Auth._loginPath();
        return false;
      }
      return true;
    },

       refreshPerms: function () {
      return fetch(ME_URL, { method: "GET", credentials: "include" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (me) { if (me) Auth._storePerms(me.permissions); })
        .catch(function () { /* never blocks login */ });
    },

    getStoredPerms: function () {
      try {
        var raw = localStorage.getItem(PERMS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    _storePerms: function (perms) {
      if (!perms) return;
      try { localStorage.setItem(PERMS_STORAGE_KEY, JSON.stringify(perms)); } catch (e) { /* ignore */ }
    },

    _storeAdmin: function (adminInfo) {
      try {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
          role: adminInfo.role,
          mobile: adminInfo.mobile,
          adminId: adminInfo.adminId,
        }));
      } catch (e) {
        console.warn("[auth] could not persist admin info to localStorage:", e);
      }
    },

         _storeOrg: function (org) {
      if (!org) return;
      try {
        Object.keys(ORG_STORAGE_KEYS).forEach(function (field) {
          if (org[field] !== undefined && org[field] !== null) {
            localStorage.setItem(ORG_STORAGE_KEYS[field], org[field]);
          }
        });
      } catch (e) {
        console.warn("[auth] could not persist org info to localStorage:", e);
      }
    },

    _clearOrg: function () {
      try {
        Object.keys(ORG_STORAGE_KEYS).forEach(function (field) {
          localStorage.removeItem(ORG_STORAGE_KEYS[field]);
        });
        localStorage.removeItem("organizationId"); // legacy key cleanup
      } catch (e) {
        /* ignore */
      }
    },

    _clearAdmin: function () {
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(PERMS_STORAGE_KEY);
      } catch (e) {
        /* ignore */
      }
      Auth._clearOrg();
    },

    _loginPath: function () {
      // var basePath = (window.NavSidebar && window.NavSidebar._config && window.NavSidebar._config.basePath) || "";
      return "/admin-login.html";
    },
  };

  window.Auth = Auth;

  /**
   * The sidebar + top nav markup, embedded directly as a string.
   *
   * WHY NOT FETCH partials/nav-sidebar.html anymore:
   * VS Code Live Server's auto-reload script-injector corrupts/truncates
   * HTML fragment files that don't contain <html>/<body> tags (confirmed
   * via debug logging — the response was being cut mid-file every time).
   * Embedding the template here removes the fetch entirely, so there is
   * nothing for Live Server (or any dev server) to intercept or mangle.
   *
   * To edit nav links: edit this string. Every page that includes
   * nav-sidebar.js updates automatically, exactly like before —
   * partials/nav-sidebar.html is now just a readable reference copy,
   * it is no longer loaded at runtime.
   */
  var NAV_SIDEBAR_TEMPLATE = [
    '<aside id="app-sidebar" class="app-sidebar">',
    '  <div class="sidebar-brand">',
    '    <a href="/dashboard/dashboard.html" class="sidebar-brand-link" aria-label="Go to dashboard">',
    '      <img src="/assets/Images/company-logo.png" alt="Company logo" class="sidebar-logo-full" />',
    '      <img src="/assets/Images/company-logo.png" alt="Company logo" class="sidebar-logo-mark" />',
    '    </a>',
    '    <button type="button" id="sidebar-collapse-btn" class="sidebar-collapse-btn" aria-label="Collapse sidebar" title="Collapse sidebar">',
    '      <i class="fa-solid fa-chevron-left"></i>',
    '    </button>',
    '  </div>',
    '  <nav class="sidebar-nav" aria-label="Primary">',
    '    <ul class="sidebar-nav-list">',

    /* ============ OVERVIEW ============ */
    '      <li class="sidebar-nav-item">',
    '        <a href="/dashboard/dashboard.html" class="sidebar-nav-link" data-page="dashboard">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-gauge"></i></span>',
    '          <span class="sidebar-nav-label">Dashboard</span>',
    '          <span class="sidebar-tooltip">Dashboard</span>',
    '        </a>',
    '      </li>',

      '      <li class="sidebar-nav-item">',
    '        <a href="/projects/projects.html" class="sidebar-nav-link" data-page="projects">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-folder"></i></span>',
    '          <span class="sidebar-nav-label">Projects</span>',
    '          <span class="sidebar-tooltip">Projects</span>',
    '        </a>',
    '      </li>',

    '      <li class="sidebar-nav-item">',
    '        <a href="/activity-log/activity-log.html" class="sidebar-nav-link" data-page="activity-log.html">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-clock-rotate-left"></i></span>',
    '          <span class="sidebar-nav-label">Activity & Logs</span>',
    '          <span class="sidebar-tooltip">activity</span>',
    '        </a>',
    '      </li>',

    /* ============ TOOLS ============ */
    '      <li class="sidebar-nav-divider" role="separator"></li>',
    '      <li class="sidebar-nav-heading"><span>Tools</span></li>',
    '      <li class="sidebar-nav-item">',
    '        <a href="/products/products.html" class="sidebar-nav-link" data-page="products">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-box"></i></span>',
    '          <span class="sidebar-nav-label">Products</span>',
    '          <span class="sidebar-tooltip">Products</span>',
    '        </a>',
    '      </li>',

    '      <li class="sidebar-nav-item">',
    '        <a href="/vendors/vendors.html" class="sidebar-nav-link" data-page="vendors">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-building"></i></span>',
    '          <span class="sidebar-nav-label">Vendors</span>',
    '          <span class="sidebar-tooltip">Vendors</span>',
    '        </a>',
    '      </li>',

    '      <li class="sidebar-nav-item">',
    '        <a href="/clients/clients.html" class="sidebar-nav-link" data-page="clients">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-users"></i></span>',
    '          <span class="sidebar-nav-label">Clients</span>',
    '          <span class="sidebar-tooltip">Clients</span>',
    '        </a>',
    '      </li>',

    /* ============ SALES ============ */
    '      <li class="sidebar-nav-divider" role="separator"></li>',
    '      <li class="sidebar-nav-heading"><span>Sales</span></li>',

    '      <li class="sidebar-nav-item">',
    '        <a href="/quotations/quotations.html" class="sidebar-nav-link" data-page="quotations">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-file-lines"></i></span>',
    '          <span class="sidebar-nav-label">Quotation</span>',
    '          <span class="sidebar-tooltip">Quotation</span>',
    '        </a>',
    '      </li>',

    '      <li class="sidebar-nav-item">',
    '        <a href="/sales-orders/sales-orders.html" class="sidebar-nav-link" data-page="sales-orders">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-cart-shopping"></i></span>',
    '          <span class="sidebar-nav-label">Sales Orders</span>',
    '          <span class="sidebar-tooltip">Sales Orders</span>',
    '        </a>',
    '      </li>',

    '      <li class="sidebar-nav-item">',
    '        <a href="/delivery-challan/delivery-challan.html" class="sidebar-nav-link" data-page="delivery-challan">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-truck"></i></span>',
    '          <span class="sidebar-nav-label">Delivery Challan</span>',
    '          <span class="sidebar-tooltip">Delivery Challan</span>',
    '        </a>',
    '      </li>',

    '      <li class="sidebar-nav-item">',
    '        <a href="/invoices/invoices.html" class="sidebar-nav-link" data-page="invoices">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-file-invoice"></i></span>',
    '          <span class="sidebar-nav-label">Invoices</span>',
    '          <span class="sidebar-tooltip">Invoices</span>',
    '        </a>',
    '      </li>',

    '      <li class="sidebar-nav-item">',
    '        <a href="/customer-payments/customer-payments.html" class="sidebar-nav-link" data-page="customer-payments">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-hand-holding-dollar"></i></span>',
    '          <span class="sidebar-nav-label">Customer Payments</span>',
    '          <span class="sidebar-tooltip">Customer Payments</span>',
    '        </a>',
    '      </li>',

    /* ============ PURCHASE ============ */
    '      <li class="sidebar-nav-divider" role="separator"></li>',
    '      <li class="sidebar-nav-heading"><span>Purchase</span></li>',

    '      <li class="sidebar-nav-item">',
    '        <a href="/purchase-orders/purchase-orders.html" class="sidebar-nav-link" data-page="purchase-orders">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-truck-fast"></i></span>',
    '          <span class="sidebar-nav-label">Purchase Orders</span>',
    '          <span class="sidebar-tooltip">Purchase Orders</span>',
    '        </a>',
    '      </li>',


    '      <li class="sidebar-nav-item">',
    '        <a href="/vendor-payments/vendor-payments.html" class="sidebar-nav-link" data-page="vendor-payments">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-money-check-dollar"></i></span>',
    '          <span class="sidebar-nav-label">Vendor Payments</span>',
    '          <span class="sidebar-tooltip">Vendor Payments</span>',
    '        </a>',
    '      </li>',

    /* ============ OPERATIONS ============ */
    '      <li class="sidebar-nav-divider" role="separator"></li>',
    '      <li class="sidebar-nav-heading"><span>Operations</span></li>',

    '      <li class="sidebar-nav-item">',
    '        <a href="/inventory/inventory.html" class="sidebar-nav-link" data-page="inventory">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-boxes-stacked"></i></span>',
    '          <span class="sidebar-nav-label">Inventory</span>',
    '          <span class="sidebar-tooltip">Inventory</span>',
    '        </a>',
    '      </li>',

    '      <li class="sidebar-nav-item">',
    '        <a href="/expenses/expenses.html" class="sidebar-nav-link" data-page="expenses">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-money-bill-wave"></i></span>',
    '          <span class="sidebar-nav-label">Expenses</span>',
    '          <span class="sidebar-tooltip">Expenses</span>',
    '        </a>',
    '      </li>',

  

    // '      <li class="sidebar-nav-item">',
    // '        <a href="/timetracking/timesheet.html" class="sidebar-nav-link" data-page="timetracking">',
    // '          <span class="sidebar-nav-icon"><i class="fa-solid fa-clock"></i></span>',
    // '          <span class="sidebar-nav-label">Time Tracking</span>',
    // '          <span class="sidebar-tooltip">Time Tracking</span>',
    // '        </a>',
    // '      </li>',

    /* ============ FINANCE ============ */
    '      <li class="sidebar-nav-divider" role="separator"></li>',
    '      <li class="sidebar-nav-heading"><span>Finance</span></li>',

    
    '      <li class="sidebar-nav-item">',
    '        <a href="/reports/reports.html" class="sidebar-nav-link" data-page="reports">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-chart-line"></i></span>',
    '          <span class="sidebar-nav-label">Reports</span>',
    '          <span class="sidebar-tooltip">Reports</span>',
    '        </a>',
    '      </li>',


    /* ============ SYSTEM ============ */
    '      <li class="sidebar-nav-divider" role="separator"></li>',
    '      <li class="sidebar-nav-heading"><span>System</span></li>',


    '      <li class="sidebar-nav-item">',
    '        <a href="/users-&-roles/users.html" class="sidebar-nav-link" data-page="users">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-users-gear"></i></span>',
    '          <span class="sidebar-nav-label">Users &amp; Roles</span>',
    '          <span class="sidebar-tooltip">Users &amp; Roles</span>',
    '        </a>',
    '      </li>',

  

    '      <li class="sidebar-nav-item">',
    '        <a href="/settings/settings.html" class="sidebar-nav-link" data-page="settings">',
    '          <span class="sidebar-nav-icon"><i class="fa-solid fa-gear"></i></span>',
    '          <span class="sidebar-nav-label">Settings</span>',
    '          <span class="sidebar-tooltip">Settings</span>',
    '        </a>',
    '      </li>',

    '    </ul>',
    '  </nav>',
    '  <hr>',
    '    <div class="text-sm m-4 text-gray-600">© 2026 Kunash Media Solutions</div>',
    '  <div class="sidebar-foot">',
    '    <button type="button" id="sidebar-expand-btn" class="sidebar-expand-btn" aria-label="Expand sidebar" title="Expand sidebar">',
    '      <i class="fa-solid fa-chevron-right"></i>',
    '    </button>',
    '  </div>',
    '</aside>',
    '<div id="sidebar-backdrop" class="sidebar-backdrop" data-close-sidebar></div>',
    '<header id="app-topbar" class="app-topbar">',
    '  <div class="topbar-left">',
    '    <button type="button" id="mobile-menu-btn" class="icon-btn mobile-only" aria-label="Open menu">',
    '      <i class="fa-solid fa-bars"></i>',
    '    </button>',
    '    <h1 id="topbar-page-title" class="topbar-page-title">Dashboard</h1>',
    '  </div>',
    '  <div class="topbar-right">',
    '    <div id="profile-menu" class="profile-menu">',
    '      <button type="button" id="profile-trigger" class="profile-trigger" aria-haspopup="true" aria-expanded="false">',
    '        <span class="profile-avatar">',
    '          <img id="profile-avatar-img" src="" alt="" class="profile-avatar-img hidden" />',
    '          <span id="profile-avatar-fallback" class="profile-avatar-fallback">A</span>',
    '        </span>',
    '        <span class="profile-meta desktop-only">',
    '          <span id="profile-name" class="profile-name">Admin User</span>',
    '          <span id="profile-role" class="profile-role">Administrator</span>',
    '        </span>',
    '        <i class="fa-solid fa-chevron-down profile-caret desktop-only"></i>',
    '      </button>',
    '      <div id="profile-dropdown" class="profile-dropdown" role="menu">',
    '        <div class="profile-dropdown-header">',
    '          <span id="profile-dropdown-name" class="profile-dropdown-name">Admin User</span>',
    '          <span id="profile-dropdown-role" class="profile-dropdown-role">Administrator</span>',
    '        </div>',
    '        <div class="profile-dropdown-divider"></div>',
    '        <div class="profile-dropdown-divider"></div>',
    '        <button type="button" id="logout-trigger" class="profile-dropdown-item profile-dropdown-item-danger" role="menuitem">',
    '          <i class="fa-solid fa-arrow-right-from-bracket"></i>',
    '          <span>Logout</span>',
    '        </button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</header>',
    '<div id="mobile-nav-panel" class="mobile-nav-panel" aria-hidden="true"></div>',
    '<div id="logout-overlay" class="confirm-overlay" aria-hidden="true">',
    '  <div class="confirm-overlay-backdrop" data-close-logout></div>',
    '  <div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="logout-dialog-title">',
    '    <div class="confirm-dialog-icon">',
    '      <i class="fa-solid fa-arrow-right-from-bracket"></i>',
    '    </div>',
    '    <h2 id="logout-dialog-title" class="confirm-dialog-title">Log out?</h2>',
    '    <p class="confirm-dialog-text">You\'ll need to sign in again to access the admin panel.</p>',
    '    <div class="confirm-dialog-actions">',
    '      <button type="button" id="logout-cancel-btn" class="confirm-btn confirm-btn-secondary">No, stay</button>',
    '      <button type="button" id="logout-confirm-btn" class="confirm-btn confirm-btn-danger">Yes, logout</button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join("\n");

  var NavSidebar = {
    _config: null,

    init: function (config) {
      this._config = Object.assign(
        {
          basePath: "",
          activePage: "",
          pageTitle: document.title || "",
          user: null, // no longer required — real admin info comes from Auth
        },
        config || {}
      );

      // Client-side session guard. Real enforcement is the http-only
      // cookie checked server-side; this just avoids flashing admin UI
      // at someone who was never logged in (or whose local cache is gone).


      //=================================================//
      //====uncomment to login check with token =======//
      //=================================================//
      
    var self = this;

      // Cookie is the source of truth. If local cache is missing, check
      // the cookie first (rebuilds the cache) before deciding to redirect.
      if (!Auth.isLoggedIn()) {
        Auth.verifySession().then(function (valid) {
          if (valid && Auth.isLoggedIn()) {
            self._start();
          } else {
            Auth._clearAdmin();
            window.location.href = Auth._loginPath();
          }
        });
        return;
      }

      // Local cache present: render immediately, verify cookie in background.
      Auth.verifySession().then(function (valid) {
        if (!valid) {
          Auth._clearAdmin();
          window.location.href = Auth._loginPath();
        } else {
          self._applyPermissions();   // fresh /me permissions override the cached ones
        }
      });
      this._start();
    },

    _start: function () {
      // Injecting the markup is the one step that must succeed for
      // anything else to make sense — if it fails, bail out entirely.
      try {
        this._inject(NAV_SIDEBAR_TEMPLATE);
      } catch (err) {
        console.error("[nav-sidebar] failed to inject markup:", err);
        this._paintReady();
        return;
      }

      // Every other step gets its OWN try/catch. Previously these were
      // all in one block, so a failure early on (e.g. a corrupted
      // localStorage admin blob in _applyUser) silently skipped
      // _applyActiveLink and every step after it — which is why the
      // active nav highlight could appear to "randomly" stop working.
      var steps = [
        "_applyUser",
        "_applyActiveLink",
        "_applyPermissions",
        "_bindCollapseToggle",
        "_bindMobileNav",
        "_bindProfileMenu",
        "_bindLogoutOverlay",
      ];
      for (var i = 0; i < steps.length; i++) {
        try {
          this[steps[i]]();
        } catch (err) {
          console.error("[nav-sidebar] " + steps[i] + " failed:", err);
        }
      }

      this._paintReady();
    },

    _inject: function (html) {
      // <template> is the browser-native, spec-guaranteed way to parse
      // an HTML fragment string into real elements.
      var template = document.createElement("template");
      template.innerHTML = html;
      var doc = template.content;

      var sidebarRoot = document.getElementById("sidebar-root");
      var topbarRoot = document.getElementById("topbar-root");

      var sidebar = doc.getElementById("app-sidebar");
      var backdrop = doc.getElementById("sidebar-backdrop");
      var topbar = doc.getElementById("app-topbar");
      var mobilePanel = doc.getElementById("mobile-nav-panel");
      var logoutOverlay = doc.getElementById("logout-overlay");

      if (!sidebar || !topbar) {
        throw new Error(
          "nav-sidebar partial is missing #app-sidebar or #app-topbar. " +
          "Check that partials/nav-sidebar.html at your basePath is the actual partial " +
          "(not empty, not a 404/index.html fallback). See the console warning above for the fetched content."
        );
      }

      if (sidebarRoot) {
        sidebarRoot.replaceWith(sidebar);
      } else {
        document.body.appendChild(sidebar);
      }
      if (topbarRoot) {
        topbarRoot.replaceWith(topbar);
      } else {
        document.body.appendChild(topbar);
      }

      // Elements that aren't inside either placeholder get appended to body.
      if (backdrop) document.body.appendChild(backdrop);
      if (mobilePanel) document.body.appendChild(mobilePanel);
      if (logoutOverlay) document.body.appendChild(logoutOverlay);
    },

    /* ---------------------------------------------------------------- */
    /* Role permissions (UX only — the server enforces every API call)    */
    /* ---------------------------------------------------------------- */
    can: function (moduleKey, action) {
      var perms = Auth.getStoredPerms();
      if (!perms) return true;                       // not loaded yet: don't flash-hide, the server still decides
      var list = perms[moduleKey];
      return !!list && list.indexOf(String(action || "VIEW").toUpperCase()) !== -1;
    },

    _moduleKeyOf: function (link) {
      return String(link.getAttribute("data-page") || "").toLowerCase().replace(/\.html$/, "");
    },

    _applyPermissions: function () {
      var self = this;
      if (!Auth.getStoredPerms()) return;

      document.querySelectorAll(".sidebar-nav-link[data-page]").forEach(function (link) {
        var li = link.closest(".sidebar-nav-item");
        if (li) li.style.display = self.can(self._moduleKeyOf(link), "VIEW") ? "" : "none";
      });
      this._hideEmptySections();

           var active = document.querySelector(".sidebar-nav-link.active");
      if (active && !this.can(this._moduleKeyOf(active), "VIEW")) this._showNoAccess();
      else this._clearNoAccess();

      // Tell the page only when permissions actually changed (cached -> fresh /me), so it can re-render its buttons
      var sig = JSON.stringify(Auth.getStoredPerms());
      if (this._permsSig && this._permsSig !== sig) document.dispatchEvent(new CustomEvent("siec:perms"));
      this._permsSig = sig;
    },

    _hideEmptySections: function () {
      var items = Array.prototype.slice.call(document.querySelectorAll("#app-sidebar .sidebar-nav-list > li"));
      var i = 0;
      while (i < items.length) {
        if (items[i].classList.contains("sidebar-nav-heading")) {
          var divider = (i > 0 && items[i - 1].classList.contains("sidebar-nav-divider")) ? items[i - 1] : null;
          var j = i + 1, anyVisible = false;
          while (j < items.length &&
                 !items[j].classList.contains("sidebar-nav-divider") &&
                 !items[j].classList.contains("sidebar-nav-heading")) {
            if (items[j].style.display !== "none") anyVisible = true;
            j++;
          }
          items[i].style.display = anyVisible ? "" : "none";
          if (divider) divider.style.display = anyVisible ? "" : "none";
          i = j;
        } else {
          i++;
        }
      }
    },

    _showNoAccess: function () {
      var main = document.querySelector("main");
      if (!main || document.getElementById("no-access-panel")) return;
      main.style.display = "none";
      var panel = document.createElement("div");
      panel.id = "no-access-panel";
      panel.style.cssText = "max-width:420px;margin:80px auto;text-align:center;padding:0 16px";
      panel.innerHTML =
        '<div style="font-size:32px;color:#d1d5db;margin-bottom:10px"><i class="fa-solid fa-lock"></i></div>' +
        '<h2 style="font-size:16px;font-weight:700;color:#1f2937">You don\'t have access to this page</h2>' +
        '<p style="font-size:12px;color:#6b7280;margin-top:6px">Ask your administrator to grant you permission for this module.</p>';
      main.parentNode.insertBefore(panel, main);
    },

    _clearNoAccess: function () {
      var panel = document.getElementById("no-access-panel");
      if (panel) panel.remove();
      var main = document.querySelector("main");
      if (main) main.style.display = "";
    },

    _paintReady: function () {
      // Double rAF ensures the browser has committed layout for the
      // injected nodes before we fade them in — avoids any flash.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          document.documentElement.classList.add("nav-ready");
        });
      });
    },

    /* ---------------------------------------------------------------- */
    /* User info + page title                                            */
    /* ---------------------------------------------------------------- */
    _applyUser: function () {
      // Real admin info (from login) takes priority; config.user is only
      // a fallback for pages that still pass one explicitly.
      var storedAdmin = Auth.getStoredAdmin();
      var user = storedAdmin
        ? { name: storedAdmin.adminId, role: storedAdmin.role }
        : (this._config.user || {});
      var title = this._config.pageTitle;

      var setText = function (id, value) {
        var el = document.getElementById(id);
        if (el && value) el.textContent = value;
      };

      setText("profile-name", user.name);
      setText("profile-role", user.role);
      setText("profile-dropdown-name", user.name);
      setText("profile-dropdown-role", user.role);
      setText("topbar-page-title", title);

      if (user.avatarUrl) {
        var img = document.getElementById("profile-avatar-img");
        var fallback = document.getElementById("profile-avatar-fallback");
        if (img) {
          img.src = user.avatarUrl;
          img.classList.remove("hidden");
        }
        if (fallback) fallback.style.display = "none";
      } else if (user.name) {
        var fallbackEl = document.getElementById("profile-avatar-fallback");
        if (fallbackEl) fallbackEl.textContent = user.name.trim().charAt(0).toUpperCase();
      }

      if (title) document.title = title;
    },

    _applyActiveLink: function () {
      var links = document.querySelectorAll(".sidebar-nav-link[data-page]");
      var page = this._config.activePage;
      var matched = false;

      // Primary: match the configured activePage against data-page,
      // case-insensitively (so "deliverychallan" still matches
      // data-page="deliveryChallan" instead of silently matching nothing).
      if (page) {
        var pageLower = String(page).toLowerCase();
        links.forEach(function (link) {
          var linkPage = (link.getAttribute("data-page") || "").toLowerCase();
          if (linkPage === pageLower) {
            link.classList.add("active");
            link.setAttribute("aria-current", "page");
            matched = true;
          }
        });
      }

      if (matched) {
        this._scrollActiveIntoView();
        return;
      }

      // Fallback: no activePage was passed, or it didn't match anything —
      // auto-detect the active link by comparing each link's URL path to
      // the current page's path. This means highlighting still works
      // correctly without relying on activePage being spelled exactly
      // right on every page.
      var currentPath = window.location.pathname.replace(/\/+$/, "").toLowerCase();
      links.forEach(function (link) {
        var href = link.getAttribute("href") || "";
        var linkPath;
        try {
          linkPath = new URL(href, window.location.origin).pathname.replace(/\/+$/, "").toLowerCase();
        } catch (e) {
          return; // malformed href, skip
        }
                if (linkPath && linkPath === currentPath) {
          link.classList.add("active");
          link.setAttribute("aria-current", "page");
        }
      });

      this._scrollActiveIntoView();
    },

    /**
     * Scrolls the sidebar nav so the active link is visible (centered)
     * when the list is longer than the viewport. Only scrolls the nav
     * container itself, never the page.
     */
    _scrollActiveIntoView: function () {
      var active = document.querySelector(".sidebar-nav-link.active");
      var nav = document.querySelector("#app-sidebar .sidebar-nav");
      if (!active || !nav) return;

      var doScroll = function () {
        var navRect = nav.getBoundingClientRect();
        var linkRect = active.getBoundingClientRect();
        var offset = linkRect.top - navRect.top - (nav.clientHeight / 2) + (linkRect.height / 2);
        nav.scrollTop += offset;
      };

      // Run after layout is committed so measurements are correct.
      requestAnimationFrame(doScroll);
    },

    /* ---------------------------------------------------------------- */
    /* Collapse / expand (desktop) — persisted in localStorage           */
    /* ---------------------------------------------------------------- */
    _bindCollapseToggle: function () {
      var collapseBtn = document.getElementById("sidebar-collapse-btn");
      var expandBtn = document.getElementById("sidebar-expand-btn");

      function setCollapsed(isCollapsed) {
        document.documentElement.classList.toggle("sidebar-collapsed", isCollapsed);
        document.documentElement.classList.toggle("sidebar-expanded", !isCollapsed);
        try {
          localStorage.setItem(STORAGE_KEY, isCollapsed ? "true" : "false");
        } catch (e) {
          /* localStorage unavailable (private mode) — state just won't persist */
        }
      }

      if (collapseBtn) {
        collapseBtn.addEventListener("click", function () {
          setCollapsed(true);
        });
      }
      if (expandBtn) {
        expandBtn.addEventListener("click", function () {
          setCollapsed(false);
        });
      }
    },

    /* ---------------------------------------------------------------- */
    /* Mobile off-canvas sidebar                                         */
    /* ---------------------------------------------------------------- */
    _bindMobileNav: function () {
      var menuBtn = document.getElementById("mobile-menu-btn");
      var backdrop = document.getElementById("sidebar-backdrop");

      function open() {
        document.documentElement.classList.add("mobile-sidebar-open");
      }
      function close() {
        document.documentElement.classList.remove("mobile-sidebar-open");
      }

      if (menuBtn) menuBtn.addEventListener("click", open);
      if (backdrop) backdrop.addEventListener("click", close);

      // Close automatically after navigating (link tap) on mobile.
      document.querySelectorAll(".sidebar-nav-link").forEach(function (link) {
        link.addEventListener("click", close);
      });

      // Esc closes mobile sidebar.
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") close();
      });

      window.addEventListener("resize", function () {
        if (window.innerWidth >= 1024) close();
      });
    },

    /* ---------------------------------------------------------------- */
    /* Profile dropdown (hover on desktop, tap-toggle on touch)          */
    /* ---------------------------------------------------------------- */
    _bindProfileMenu: function () {
      var menu = document.getElementById("profile-menu");
      var trigger = document.getElementById("profile-trigger");
      if (!menu || !trigger) return;

      function setOpen(isOpen) {
        menu.classList.toggle("open", isOpen);
        trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
      }

      trigger.addEventListener("click", function (e) {
        e.stopPropagation();
        setOpen(!menu.classList.contains("open"));
      });

      document.addEventListener("click", function (e) {
        if (!menu.contains(e.target)) setOpen(false);
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") setOpen(false);
      });
    },

    /* ---------------------------------------------------------------- */
    /* Logout confirmation overlay (Yes / No)                            */
    /* ---------------------------------------------------------------- */
    _bindLogoutOverlay: function () {
      var overlay = document.getElementById("logout-overlay");
      var openTrigger = document.getElementById("logout-trigger");
      var cancelBtn = document.getElementById("logout-cancel-btn");
      var confirmBtn = document.getElementById("logout-confirm-btn");
      var closeTargets = overlay ? overlay.querySelectorAll("[data-close-logout]") : [];
      if (!overlay || !openTrigger) return;

      function openOverlay() {
        overlay.classList.add("open");
        overlay.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
      }
      function closeOverlay() {
        overlay.classList.remove("open");
        overlay.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
      }

      openTrigger.addEventListener("click", function () {
        // Close any open profile dropdown first, then confirm.
        var menu = document.getElementById("profile-menu");
        if (menu) menu.classList.remove("open");
        openOverlay();
      });

      closeTargets.forEach(function (el) {
        el.addEventListener("click", closeOverlay);
      });
      if (cancelBtn) cancelBtn.addEventListener("click", closeOverlay);

      if (confirmBtn) {
        confirmBtn.addEventListener("click", function () {
          NavSidebar.onLogoutConfirmed();
        });
      }

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && overlay.classList.contains("open")) closeOverlay();
      });
    },

    /**
     * Real logout — clears the session and redirects. Pages don't need
     * to override this anymore; it's wired to Auth.logout() by default.
     * Still overridable if a page ever needs custom post-logout behavior:
     *   NavSidebar.onLogoutConfirmed = function () { ...; Auth.logout(); };
     */
    onLogoutConfirmed: function () {
      Auth.logout();
    },
  };

  window.NavSidebar = NavSidebar;
})(window, document);