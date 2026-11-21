"""
Unit test suite verifying the Shell & Retractable Sidebar Redesign for VS Database (Unslop Edition).
Tests:
1. Retractable sidebar (collapse/expand, width 240px / 68px, icon swap, label toggle, localStorage, Ctrl+B).
2. Titlebar audit (neutral palette, window control buttons visibility & protection against connection banners).
3. Shell CSS rules & transitions.
"""

import unittest
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"


class TestShellRedesign(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html_path = STATIC_DIR / "index.html"
        cls.css_path = STATIC_DIR / "app.css"
        cls.js_path = STATIC_DIR / "app.js"

        cls.html = cls.html_path.read_text(encoding="utf-8")
        cls.css = cls.css_path.read_text(encoding="utf-8")
        cls.js = cls.js_path.read_text(encoding="utf-8")

    def test_sidebar_toggle_button_in_html(self):
        """Verify sidebar toggle button exists with proper accessibility attributes."""
        self.assertIn('id="sidebar-toggle-btn"', self.html)
        self.assertIn('class="sidebar-toggle-btn"', self.html)
        self.assertIn('aria-label="Toggle sidebar"', self.html)
        self.assertIn('aria-expanded="true"', self.html)

    def test_brand_logos_full_and_monogram_in_html(self):
        """Verify brand header contains both full logo and monogram for collapsed swap."""
        self.assertIn('vs-logo-full', self.html)
        self.assertIn('vs-logo-monogram', self.html)
        self.assertIn('logo.png', self.html)
        self.assertIn('logo Monogram.png', self.html)

    def test_nav_buttons_have_clean_tooltips(self):
        """Verify all nav buttons have titles/tooltips so icons are self-documenting when collapsed."""
        expected_pages = [
            ("dashboard", "Dashboard"),
            ("clients", "Clients"),
            ("folders", "Folder Structure"),
            ("save", "Save Files"),
            ("pdf-studio", "Studio"),
            ("vs-ai", "VS AI"),
            ("drive", "Drive Sharing"),
            ("backup", "Backup & Restore"),
            ("automation", "Automation"),
            ("activity", "Activity"),
            ("setup", "Setup"),
        ]
        for page, title in expected_pages:
            self.assertIn(f'data-page="{page}"', self.html)
            self.assertIn(f'title="{title}"', self.html)

    def test_sidebar_css_collapsed_dimensions_and_transitions(self):
        """Verify CSS contains 240px expanded, 68px collapsed, and fluid grid transitions."""
        self.assertIn("--sidebar-w-expanded: 240px;", self.css)
        self.assertIn("--sidebar-w-collapsed: 68px;", self.css)
        self.assertIn("transition: grid-template-columns", self.css)
        self.assertIn(".app.sidebar-collapsed", self.css)
        self.assertIn(".app.sidebar-collapsed .side", self.css)
        self.assertIn(".app.sidebar-collapsed .vs-logo-monogram", self.css)
        self.assertIn(".app.sidebar-collapsed nav button span", self.css)

    def test_sidebar_js_persistence_and_shortcuts(self):
        """Verify localStorage persistence key 'vs_sidebar_collapsed' and keyboard shortcut."""
        self.assertIn("vs_sidebar_collapsed", self.js)
        self.assertIn("localStorage.setItem('vs_sidebar_collapsed'", self.js)
        self.assertIn("localStorage.getItem('vs_sidebar_collapsed')", self.js)
        self.assertIn("initSidebarCollapse", self.js)
        self.assertIn("window.toggleSidebar", self.js)
        # Verify Ctrl+B / Cmd+B keyboard shortcut handler
        self.assertIn("key === 'b' || e.key === 'B'", self.js)

    def test_titlebar_neutral_palette(self):
        """Verify titlebar and buttons use clean neutral palette and no slop colors."""
        self.assertIn(".app-titlebar {", self.css)
        self.assertIn("background: #ffffff;", self.css)
        self.assertIn("border-bottom: 1px solid #e2e8f0;", self.css)
        self.assertIn(".titlebar-badge {", self.css)
        self.assertIn("background: #f1f5f9;", self.css)
        self.assertIn("color: #475569;", self.css)

    def test_window_controls_protection_against_banners(self):
        """Verify window controls have z-index protection and banners are constrained."""
        self.assertIn("z-index: 10000 !important;", self.css)
        self.assertIn("z-index: 10001 !important;", self.css)
        self.assertIn("app-region: no-drag !important;", self.css)
        self.assertIn(".connection-banner", self.css)


if __name__ == "__main__":
    unittest.main()
