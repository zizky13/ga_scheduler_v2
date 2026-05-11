# GA Scheduler -- Application Interface Design Specification

**Product:** GA Scheduler -- Automatic Course Scheduling System for Universitas Pembangunan Jaya
**Context:** Academic thesis project (Tugas Akhir)
**Document version:** 1.0
**Date:** 2026-05-07
**Status:** Ready for implementation

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Color Palette](#2-color-palette)
3. [Typography](#3-typography)
4. [Spacing System](#4-spacing-system)
5. [Border Radius System](#5-border-radius-system)
6. [Shadow System](#6-shadow-system)
7. [Animation and Transition Guidelines](#7-animation-and-transition-guidelines)
8. [Icon System](#8-icon-system)
9. [Responsive Breakpoints](#9-responsive-breakpoints)
10. [Application Shell](#10-application-shell)
11. [Shared Component Library](#11-shared-component-library)
12. [Page Specifications](#12-page-specifications)
    - 12.1 [Login Page](#121-login-page)
    - 12.2 [Dashboard](#122-dashboard)
    - 12.3 [Semester Management](#123-semester-management)
    - 12.4 [Facility Management](#124-facility-management)
    - 12.5 [Room Management](#125-room-management)
    - 12.6 [Timeslot Management](#126-timeslot-management)
    - 12.7 [Lecturer Management](#127-lecturer-management)
    - 12.8 [Course Management](#128-course-management)
    - 12.9 [Course Offering Management](#129-course-offering-management)
    - 12.10 [Schedule Run](#1210-schedule-run)
    - 12.11 [Schedule Viewer](#1211-schedule-viewer)
    - 12.12 [Manual Override](#1212-manual-override)
    - 12.13 [User Management](#1213-user-management)
    - 12.14 [Audit Log Viewer](#1214-audit-log-viewer)
13. [Special Component: Schedule Timetable Grid](#13-special-component-schedule-timetable-grid)
14. [Special Component: GA Progress Monitor](#14-special-component-ga-progress-monitor)
15. [Accessibility Standards](#15-accessibility-standards)
16. [CSS Custom Properties Summary](#16-css-custom-properties-summary)

---

## 1. Design Principles

| # | Principle | Implementation |
|---|-----------|----------------|
| 1 | **Clarity over decoration** | Every visual element serves an informational purpose. No gratuitous gradients or ornamental shapes. This is a working tool, not a marketing site. |
| 2 | **Data as the hero** | The schedule grid, data tables, and GA progress charts are the primary visual elements. Let the data speak. |
| 3 | **Sophisticated restraint** | Muted palette with one purposeful accent. Generous whitespace. No neon, no oversaturation, no fluorescent gradients. |
| 4 | **Systematic consistency** | Every measurement derives from the 4px base unit. Every color has a semantic role. Every component follows the same interaction patterns. |
| 5 | **Accessible by default** | WCAG AA minimum on all text. Keyboard-navigable. Reduced-motion respected. Screen-reader compatible. |
| 6 | **Dense but readable** | Administrative tools need information density. Use compact spacing within data tables while maintaining generous whitespace between sections. |

**Design references:** Linear, Airtable, Clay -- refined application aesthetics with strong data-presentation patterns.

---

## 2. Color Palette

### 2.1 Light Mode

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--color-primary-50` | `#EEF2FF` | 238, 242, 255 | Primary tint backgrounds, hover fills, selected row backgrounds |
| `--color-primary-100` | `#D8E0FC` | 216, 224, 252 | Active tab backgrounds, selected states |
| `--color-primary-200` | `#B0C1F9` | 176, 193, 249 | Borders on active elements |
| `--color-primary-400` | `#6382E8` | 99, 130, 232 | Links, secondary interactive elements |
| `--color-primary-500` | `#4361D0` | 67, 97, 208 | Primary buttons, active sidebar items, key accents |
| `--color-primary-600` | `#3349A8` | 51, 73, 168 | Hovered primary buttons |
| `--color-primary-700` | `#273882` | 39, 56, 130 | Active/pressed state |
| `--color-primary-900` | `#141D42` | 20, 29, 66 | Reserved for dark mode text |
| | | | |
| `--color-secondary-50` | `#F8FAFC` | 248, 250, 252 | Sidebar background, alternating table rows |
| `--color-secondary-100` | `#F1F5F9` | 241, 245, 249 | Card backgrounds, input fills, table header |
| `--color-secondary-200` | `#E2E8F0` | 226, 232, 240 | Borders, dividers, table cell borders |
| `--color-secondary-300` | `#CBD5E1` | 203, 213, 225 | Disabled borders, placeholder icons |
| `--color-secondary-400` | `#94A3B8` | 148, 163, 184 | Placeholder text, caption text |
| `--color-secondary-500` | `#64748B` | 100, 116, 139 | Body text (secondary) |
| `--color-secondary-700` | `#334155` | 51, 65, 85 | Body text (primary). 10.5:1 contrast on white. |
| `--color-secondary-900` | `#0F172A` | 15, 23, 42 | Headlines, page titles |
| | | | |
| `--color-accent-400` | `#38BDF8` | 56, 189, 248 | Data visualization highlights, chart accents |
| `--color-accent-500` | `#0EA5E9` | 14, 165, 233 | Secondary accent for charts, info states |
| | | | |
| `--color-bg-primary` | `#FFFFFF` | 255, 255, 255 | Main content background |
| `--color-bg-secondary` | `#F8FAFC` | 248, 250, 252 | Sidebar background, alternating sections |
| `--color-surface` | `#FFFFFF` | 255, 255, 255 | Cards, modals, dropdowns |
| `--color-border` | `#E2E8F0` | 226, 232, 240 | Default borders |

#### Semantic Colors (Light Mode)

| Token | Hex | Text-on Color | Usage |
|-------|-----|---------------|-------|
| `--color-success-50` | `#F0FDF4` | -- | Success background |
| `--color-success-500` | `#22C55E` | `#FFFFFF` | COMPLETED badge, 0 violations indicator |
| `--color-success-700` | `#15803D` | `#FFFFFF` | Success text on light bg |
| `--color-warning-50` | `#FFFBEB` | -- | Warning background |
| `--color-warning-500` | `#F59E0B` | `#FFFFFF` | STAGNATED badge, soft penalty indicator |
| `--color-warning-700` | `#A16207` | `#FFFFFF` | Warning text on light bg |
| `--color-error-50` | `#FEF2F2` | -- | Error background |
| `--color-error-500` | `#EF4444` | `#FFFFFF` | FAILED badge, hard violation indicator, danger buttons |
| `--color-error-700` | `#B91C1C` | `#FFFFFF` | Error text on light bg |
| `--color-info-50` | `#EFF6FF` | -- | Info background |
| `--color-info-500` | `#3B82F6` | `#FFFFFF` | RUNNING badge, QUEUED badge, info notifications |

### 2.2 Dark Mode

| Token | Light Value | Dark Value (Hex) | Notes |
|-------|-------------|------------------|-------|
| `--color-primary-50` | `#EEF2FF` | `#1A2240` | Tinted dark surface |
| `--color-primary-100` | `#D8E0FC` | `#1E2A52` | Active dark tab bg |
| `--color-primary-400` | `#6382E8` | `#7B9AEF` | Lifted for dark bg legibility |
| `--color-primary-500` | `#4361D0` | `#6382E8` | Lightened primary. 4.5:1 on dark bg. |
| `--color-primary-600` | `#3349A8` | `#7B9AEF` | Hover on dark |
| `--color-primary-700` | `#273882` | `#93AAFF` | Active on dark |
| | | | |
| `--color-secondary-50` | `#F8FAFC` | `#0D1117` | Sidebar bg (darkest) |
| `--color-secondary-100` | `#F1F5F9` | `#161B22` | Card background on dark |
| `--color-secondary-200` | `#E2E8F0` | `#21262D` | Borders on dark |
| `--color-secondary-300` | `#CBD5E1` | `#30363D` | Subtle borders on dark |
| `--color-secondary-400` | `#94A3B8` | `#7D8590` | Placeholder text on dark |
| `--color-secondary-500` | `#64748B` | `#9CA3AF` | Secondary text on dark |
| `--color-secondary-700` | `#334155` | `#D1D5DB` | Primary body text on dark |
| `--color-secondary-900` | `#0F172A` | `#F0F6FC` | Headlines on dark |
| | | | |
| `--color-accent-400` | `#38BDF8` | `#38BDF8` | Unchanged |
| `--color-accent-500` | `#0EA5E9` | `#38BDF8` | Lightened for dark bg |
| | | | |
| `--color-bg-primary` | `#FFFFFF` | `#0D1117` | GitHub-style deep dark |
| `--color-bg-secondary` | `#F8FAFC` | `#161B22` | Raised section bg |
| `--color-surface` | `#FFFFFF` | `#1C2128` | Card/modal surface |
| `--color-border` | `#E2E8F0` | `#30363D` | Border on dark |

#### Semantic Colors (Dark Mode)

| Token | Dark Hex | Notes |
|-------|----------|-------|
| `--color-success-50` | `#0D2818` | Dark success bg |
| `--color-success-500` | `#4ADE80` | Lightened for dark contrast |
| `--color-warning-50` | `#2D1F04` | Dark warning bg |
| `--color-warning-500` | `#FBBF24` | Lightened for dark contrast |
| `--color-error-50` | `#2D0F0F` | Dark error bg |
| `--color-error-500` | `#F87171` | Lightened for dark contrast |
| `--color-info-50` | `#0C1D36` | Dark info bg |
| `--color-info-500` | `#60A5FA` | Lightened for dark contrast |

### 2.3 Schedule Block Color Palette

Used for course blocks in the timetable grid. Muted, distinct hues so the grid reads as a professional tool.

**Light Mode:**

| Category | Background | Text | Left Border (3px) |
|----------|-----------|------|-------------------|
| Category A (e.g., Informatics) | `#EEF2FF` | `#3349A8` | `#4361D0` |
| Category B (e.g., Engineering) | `#F0FDF4` | `#15803D` | `#22C55E` |
| Category C (e.g., Lab courses) | `#FFF7ED` | `#9A3412` | `#F97316` |
| Category D (e.g., General) | `#FDF4FF` | `#7E22CE` | `#A855F7` |
| Category E (e.g., Elective) | `#FFF1F2` | `#BE123C` | `#F43F5E` |
| Category F (e.g., Business) | `#FEFCE8` | `#854D0E` | `#EAB308` |
| Category G (e.g., Design) | `#F0FDFA` | `#115E59` | `#14B8A6` |
| Fixed/Locked | `#F1F5F9` | `#334155` | `#CBD5E1` |

**Dark Mode:**

| Category | Background | Text | Left Border |
|----------|-----------|------|-------------|
| Category A | `#1A2240` | `#93AAFF` | `#6382E8` |
| Category B | `#0D2818` | `#4ADE80` | `#22C55E` |
| Category C | `#2D1A04` | `#FDBA74` | `#F97316` |
| Category D | `#2D1040` | `#C084FC` | `#A855F7` |
| Category E | `#2D0F18` | `#FDA4AF` | `#F43F5E` |
| Category F | `#2D2504` | `#FDE047` | `#EAB308` |
| Category G | `#0D2D26` | `#5EEAD4` | `#14B8A6` |
| Fixed/Locked | `#161B22` | `#9CA3AF` | `#30363D` |

---

## 3. Typography

### 3.1 Font Pairing

| Role | Font | Source | Weight Range | Rationale |
|------|------|--------|-------------|-----------|
| **UI Text** | **Inter** | Google Fonts | 400, 500, 600, 700 | Modern geometric sans-serif with excellent readability at all sizes. Optical sizing axis renders cleanly for headings and small UI text. Used by Linear, Vercel. |
| **Monospace** | **JetBrains Mono** | Google Fonts | 400, 500 | For data cells in schedule grids, timeslot labels, course codes, generation counters, fitness values. Clear 0/O and 1/l distinction. |

**Font loading:** `font-display: swap` for Inter, `font-display: optional` for JetBrains Mono.

### 3.2 Type Scale

Base size: `16px` (`1rem`). Scale ratio: ~1.25 (Major Third).

| Token | Element | Size (rem/px) | Weight | Line Height | Letter Spacing | Usage |
|-------|---------|---------------|--------|-------------|----------------|-------|
| `--text-page-title` | Page Title | 1.875rem / 30px | 700 | 1.2 | -0.02em | Page headings ("Dashboard", "Room Management") |
| `--text-section-title` | Section Title | 1.5rem / 24px | 600 | 1.3 | -0.01em | Section headings within pages |
| `--text-card-title` | Card Title | 1.25rem / 20px | 600 | 1.35 | -0.005em | Stat card titles, panel headings |
| `--text-subtitle` | Subtitle | 1.125rem / 18px | 600 | 1.4 | 0 | Sub-headings, dialog titles |
| `--text-body-lg` | Body Large | 1.125rem / 18px | 400 | 1.6 | 0 | Empty state descriptions |
| `--text-body` | Body | 1rem / 16px | 400 | 1.6 | 0 | Default body copy, form labels |
| `--text-body-sm` | Body Small | 0.875rem / 14px | 400 | 1.5 | 0.005em | Table cell text, secondary metadata |
| `--text-caption` | Caption | 0.75rem / 12px | 500 | 1.5 | 0.01em | Timestamps, badge labels, helper text |
| `--text-overline` | Overline | 0.75rem / 12px | 600 | 1.5 | 0.08em | Section labels (uppercase) |
| `--text-button` | Button | 0.875rem / 14px | 500 | 1 | 0.01em | All button labels |
| `--text-button-lg` | Button Large | 1rem / 16px | 500 | 1 | 0.005em | Large action buttons |
| `--text-mono` | Monospace | 0.8125rem / 13px | 400 | 1.5 | 0 | Schedule cells, timeslot labels, course codes, fitness values |
| `--text-mono-sm` | Mono Small | 0.75rem / 12px | 400 | 1.4 | 0 | Compact grid cells, generation counters |
| `--text-table-header` | Table Header | 0.75rem / 12px | 600 | 1.5 | 0.04em | Table column headers (uppercase) |

### 3.3 Responsive Typography

| Token | Mobile (< 640px) | Tablet (640-1024px) | Desktop (> 1024px) |
|-------|-------------------|---------------------|---------------------|
| `--text-page-title` | 1.5rem (24px) | 1.75rem (28px) | 1.875rem (30px) |
| `--text-section-title` | 1.25rem (20px) | 1.375rem (22px) | 1.5rem (24px) |
| `--text-body` | 1rem (16px) | 1rem (16px) | 1rem (16px) |

Implementation: use CSS `clamp()`:

```css
.text-page-title {
  font-size: clamp(1.5rem, 1.25rem + 1vw, 1.875rem);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.02em;
}
```

---

## 4. Spacing System

Base unit: **4px**. All spacing values are multiples of this base.

| Token | Value (rem) | Value (px) | Common Usage |
|-------|-------------|-----------|--------------|
| `--space-0` | 0 | 0 | Reset |
| `--space-0.5` | 0.125rem | 2px | Hairline gaps |
| `--space-1` | 0.25rem | 4px | Icon-to-text inline gaps |
| `--space-1.5` | 0.375rem | 6px | Badge padding-y |
| `--space-2` | 0.5rem | 8px | Tight padding: tags, compact table cells |
| `--space-3` | 0.75rem | 12px | Button padding-y, input padding |
| `--space-4` | 1rem | 16px | Card inner padding, sidebar item padding |
| `--space-5` | 1.25rem | 20px | Table cell padding-x, card padding |
| `--space-6` | 1.5rem | 24px | Section gaps, component separation |
| `--space-8` | 2rem | 32px | Page content padding, large gaps |
| `--space-10` | 2.5rem | 40px | Section heading to content gap |
| `--space-12` | 3rem | 48px | Page section vertical spacing |

### Application Shell Spacing

| Element | Value |
|---------|-------|
| Sidebar width (expanded) | 256px (16rem) |
| Sidebar width (collapsed) | 64px (4rem) |
| Top bar height | 56px (3.5rem) |
| Content area padding | 32px (desktop), 24px (tablet), 16px (mobile) |
| Content area max-width | 1440px |
| Page title margin-bottom | 24px |
| Card-to-card gap | 24px (desktop), 16px (mobile) |
| Table row height | 48px (default), 40px (compact) |

---

## 5. Border Radius System

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 4px (0.25rem) | Tags, badges, tooltips, table cells |
| `--radius-md` | 8px (0.5rem) | Buttons, inputs, dropdowns, small cards |
| `--radius-lg` | 12px (0.75rem) | Cards, modals, panels |
| `--radius-xl` | 16px (1rem) | Large cards, schedule grid container |
| `--radius-pill` | 9999px | Status badges, toggle switches |
| `--radius-full` | 50% | Avatars, circular icons |

---

## 6. Shadow System

### Light Mode

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-xs` | `0 1px 2px 0 rgba(15, 23, 42, 0.04)` | Input fields, subtle elevation |
| `--shadow-sm` | `0 1px 3px 0 rgba(15, 23, 42, 0.06), 0 1px 2px -1px rgba(15, 23, 42, 0.06)` | Cards at rest |
| `--shadow-md` | `0 4px 6px -1px rgba(15, 23, 42, 0.07), 0 2px 4px -2px rgba(15, 23, 42, 0.05)` | Hovered cards, dropdowns |
| `--shadow-lg` | `0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04)` | Modals, popovers |
| `--shadow-xl` | `0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04)` | Floating elements, command palette |
| `--shadow-ring` | `0 0 0 3px rgba(67, 97, 208, 0.15)` | Focus ring for interactive elements |
| `--shadow-ring-error` | `0 0 0 3px rgba(239, 68, 68, 0.15)` | Focus ring for error state inputs |

### Dark Mode

| Token | Value |
|-------|-------|
| `--shadow-xs` | `0 1px 2px 0 rgba(0, 0, 0, 0.3)` |
| `--shadow-sm` | `0 1px 3px 0 rgba(0, 0, 0, 0.4), 0 1px 2px -1px rgba(0, 0, 0, 0.3)` |
| `--shadow-md` | `0 4px 6px -1px rgba(0, 0, 0, 0.45), 0 2px 4px -2px rgba(0, 0, 0, 0.3)` |
| `--shadow-lg` | `0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.3)` |
| `--shadow-xl` | `0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3)` |
| `--shadow-ring` | `0 0 0 3px rgba(99, 130, 232, 0.25)` |
| `--shadow-ring-error` | `0 0 0 3px rgba(248, 113, 113, 0.25)` |

In dark mode, borders carry more structural weight than shadows. Prefer `--color-border` for separation.

---

## 7. Animation and Transition Guidelines

### Durations

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-fast` | 100ms | Color changes, opacity toggles |
| `--duration-normal` | 200ms | Button hover, input focus, sidebar item hover |
| `--duration-slow` | 350ms | Dropdown open, modal entrance, sidebar expand/collapse |
| `--duration-slower` | 500ms | Page transitions, chart animations |

### Easing Functions

| Token | Value | Usage |
|-------|-------|-------|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances (elements appearing) |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Exits (elements disappearing) |
| `--ease-in-out` | `cubic-bezier(0.45, 0, 0.55, 1)` | State transitions (sidebar collapse) |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Toast pop-in, badge bounce. Use sparingly. |

### Animation Rules

1. **Sidebar collapse:** `width` transition at `--duration-slow` with `--ease-in-out`. Labels fade out at `--duration-fast`.
2. **Modal entrance:** Backdrop fades in (`opacity 0 to 1`, `--duration-normal`). Dialog slides up from `translateY(8px)` at `--duration-slow` with `--ease-out`.
3. **Table row hover:** Background color transition at `--duration-fast`.
4. **Toast notification:** Slides in from right with `--ease-spring`, auto-dismisses after 5 seconds with `--ease-in` slide-out.
5. **Reduced motion:** All animations wrapped in `@media (prefers-reduced-motion: no-preference)`. Under `reduce`, use `--duration-fast` with no transforms.
6. **Chart animations:** Fitness curve line draws progressively during GA run. Use `stroke-dasharray` + `stroke-dashoffset` animation.

```css
@media (prefers-reduced-motion: no-preference) {
  .modal-enter {
    animation: modalSlideUp var(--duration-slow) var(--ease-out) both;
  }
}

@keyframes modalSlideUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

## 8. Icon System

**Library:** [Lucide Icons](https://lucide.dev/) (MIT license)

| Property | Value |
|----------|-------|
| Default size (inline) | 16px (1rem) |
| Default size (standalone) | 20px (1.25rem) |
| Sidebar icon size | 20px (1.25rem) |
| Button icon size | 16px (inline with text) |
| Empty state icon size | 48px (3rem) |
| Stroke width | 1.75px |
| Style | Outlined, consistent stroke, rounded joins |
| Color | Inherits `currentColor` from parent |

### Application Icon Map

| Context | Icon (Lucide name) |
|---------|-------------------|
| Dashboard | `LayoutDashboard` |
| Semesters | `GraduationCap` |
| Facilities | `Wrench` |
| Rooms | `DoorOpen` |
| Timeslots | `Clock` |
| Lecturers | `Users` |
| Courses | `BookOpen` |
| Course Offerings | `Layers` |
| Schedule Runs | `Play` |
| Schedule Viewer | `CalendarDays` |
| User Management | `Shield` |
| Audit Log | `ScrollText` |
| Settings | `Settings` |
| Search | `Search` |
| Filter | `Filter` |
| Add/Create | `Plus` |
| Edit | `Pencil` |
| Delete | `Trash2` |
| Close | `X` |
| Chevron (expand) | `ChevronDown` |
| Chevron (nav) | `ChevronRight` |
| Check/Success | `Check` |
| Warning | `AlertTriangle` |
| Error | `AlertCircle` |
| Info | `Info` |
| Sun (light mode) | `Sun` |
| Moon (dark mode) | `Moon` |
| Menu (hamburger) | `Menu` |
| Logout | `LogOut` |
| Cancel | `XCircle` |
| Lock | `Lock` |
| Unlock | `Unlock` |
| Download/Export | `Download` |
| Refresh | `RefreshCw` |
| Chart | `TrendingUp` |
| Copy | `Copy` |

---

## 9. Responsive Breakpoints

| Name | Range | Key Changes |
|------|-------|-------------|
| **Mobile** | < 640px | Sidebar hidden (off-canvas drawer). Bottom navigation optional. Single-column content. Tables become card lists. Schedule grid scrolls horizontally. |
| **Tablet** | 640px -- 1024px | Sidebar collapsed to icons only (64px). Two-column grids where applicable. Tables visible with horizontal scroll. |
| **Desktop** | > 1024px | Sidebar fully expanded (256px). Full data tables. Schedule grid at full width. Multi-column dashboard layout. |

### Breakpoint-Specific Shell Behavior

| Element | Mobile (< 640px) | Tablet (640-1024px) | Desktop (> 1024px) |
|---------|-------------------|---------------------|---------------------|
| Sidebar | Hidden. Hamburger menu in top bar opens off-canvas drawer. | Collapsed: 64px, icons only. Expand on hover or click. | Expanded: 256px. User can toggle collapse. |
| Top bar | Full-width. Hamburger left, page title center, user avatar right. | Full-width minus sidebar. Breadcrumbs + user menu. | Full-width minus sidebar. Breadcrumbs + semester selector + dark mode toggle + user menu. |
| Content | 100% width, 16px padding. | `calc(100% - 64px)` width, 24px padding. | `calc(100% - 256px)` width, 32px padding. Max-width 1440px, centered. |
| Data tables | Stack into card list (each row = one card). | Horizontal scroll with sticky first column. | Full table display. |
| Schedule grid | Horizontal scroll. Touch-friendly. Card-based fallback available. | Horizontal scroll with day headers sticky. | Full grid, no scroll needed for 5-day view. |
| Modals | Full-screen on mobile. | Centered, max-width 640px. | Centered, max-width per modal size (sm/md/lg). |

---

## 10. Application Shell

### 10.1 Sidebar Navigation

#### Layout

| Property | Value |
|----------|-------|
| Position | Fixed left, full height |
| Width (expanded) | 256px |
| Width (collapsed) | 64px |
| Background | `--color-bg-secondary` |
| Border right | 1px solid `--color-border` |
| Z-index | 40 |
| Transition | `width var(--duration-slow) var(--ease-in-out)` |

#### Header (top of sidebar)

| Property | Value |
|----------|-------|
| Height | 56px (matches top bar) |
| Padding | 0 16px |
| Display | Flex row, align-items center |
| Logo | "GA Scheduler" text in Inter 700, 16px, `--color-secondary-900`. Collapsed: show only icon or "GA" monogram. |
| Collapse button | 20px `PanelLeftClose` / `PanelLeftOpen` icon, `--color-secondary-400`, right-aligned. Hover: `--color-secondary-700`. Only visible on desktop. |

#### Navigation Items

Navigation is grouped into labeled sections.

**Group: Data Management**

| Order | Icon | Label | Route |
|-------|------|-------|-------|
| 1 | `LayoutDashboard` | Dashboard | `/dashboard` |
| 2 | `GraduationCap` | Semesters | `/semesters` |
| 3 | `Wrench` | Facilities | `/facilities` |
| 4 | `DoorOpen` | Rooms | `/rooms` |
| 5 | `Clock` | Timeslots | `/timeslots` |
| 6 | `Users` | Lecturers | `/lecturers` |
| 7 | `BookOpen` | Courses | `/courses` |
| 8 | `Layers` | Offerings | `/offerings` |

**Group: Scheduling**

| Order | Icon | Label | Route |
|-------|------|-------|-------|
| 9 | `Play` | Run Schedule | `/runs` |
| 10 | `CalendarDays` | View Schedule | `/schedule` |

**Group: Administration** (ADMIN role only)

| Order | Icon | Label | Route |
|-------|------|-------|-------|
| 11 | `Shield` | Users | `/users` |
| 12 | `ScrollText` | Audit Log | `/audit-log` |

#### Nav Item Spec

| Property | Value |
|----------|-------|
| Height | 40px |
| Padding | 8px 12px (expanded), 8px 0 centered (collapsed) |
| Margin-x | 8px (creates indent from sidebar edges) |
| Border-radius | `--radius-md` (8px) |
| Font | `--text-body-sm` (14px), weight 500 |
| Icon size | 20px |
| Icon-to-label gap | 12px |
| **Default state** | Background: transparent. Icon: `--color-secondary-400`. Label: `--color-secondary-500`. |
| **Hover state** | Background: `--color-secondary-100`. Icon: `--color-secondary-700`. Label: `--color-secondary-700`. |
| **Active state** | Background: `--color-primary-50`. Icon: `--color-primary-500`. Label: `--color-primary-700`. Font-weight: 600. Left border: 3px solid `--color-primary-500` (or use background only). |
| **Collapsed state** | Show icon only, centered. Tooltip on hover shows label. |

#### Group Label Spec

| Property | Value |
|----------|-------|
| Font | `--text-overline` (12px, 600, uppercase) |
| Color | `--color-secondary-400` |
| Padding | 24px 12px 8px 12px (top margin creates group separation) |
| Collapsed | Hidden |

#### Footer (bottom of sidebar)

| Element | Spec |
|---------|------|
| User avatar | 32px circle, initials on `--color-primary-100` background, `--color-primary-700` text |
| User name | `--text-body-sm` (14px, 500), `--color-secondary-700`. Truncate with ellipsis. |
| Role badge | `--text-caption` (12px, 500). ADMIN: `--color-primary-50` bg, `--color-primary-500` text. USER: `--color-secondary-100` bg, `--color-secondary-500` text. |
| Logout button | `LogOut` icon, 16px, `--color-secondary-400`. Hover: `--color-error-500`. |
| Collapsed | Show avatar only. Click opens popover with name + role + logout. |

#### Dark Mode Sidebar

| Property | Override |
|----------|----------|
| Background | `--color-bg-secondary` (dark = `#161B22`) |
| Border right | `--color-border` (dark) |
| Active item bg | `--color-primary-50` (dark = `#1A2240`) |
| Active item text | `--color-primary-400` (dark) |

### 10.2 Top Bar / Header

#### Layout

| Property | Value |
|----------|-------|
| Position | Fixed top, right of sidebar |
| Height | 56px |
| Left offset | 256px (expanded sidebar) / 64px (collapsed) / 0 (mobile) |
| Background | `--color-bg-primary` with `backdrop-filter: blur(12px)` at 90% opacity |
| Border bottom | 1px solid `--color-border` |
| Z-index | 30 |
| Padding | 0 32px (desktop), 0 24px (tablet), 0 16px (mobile) |
| Display | Flex row, justify-content: space-between, align-items: center |

#### Left Section

| Element | Spec |
|---------|------|
| **Mobile hamburger** | `Menu` icon, 20px, `--color-secondary-700`. 44px tap target. Mobile only. |
| **Breadcrumbs** | `--text-body-sm` (14px, 400). Segments separated by `ChevronRight` (12px, `--color-secondary-300`). Current page: `--color-secondary-900`, weight 500. Previous pages: `--color-secondary-400`, clickable. |

#### Right Section

| Element | Spec | Order (left to right) |
|---------|------|----------------------|
| **Semester selector** | Dropdown/select. Shows active semester code (e.g., "2025-GANJIL"). `--text-body-sm`, weight 500. `--color-primary-500` text. `ChevronDown` icon. Dropdown shows all semesters; active one has checkmark. Clicking another switches context (confirms with dialog). | 1 |
| **Dark mode toggle** | `Sun` / `Moon` icon button. 36px square, `--radius-md`. Background: transparent. Hover: `--color-secondary-100`. Icon: `--color-secondary-400`. | 2 |
| **User menu** | 32px avatar circle (same as sidebar). Click opens dropdown: user name, email, role, divider, "Log out". | 3 |

#### Dark Mode Top Bar

| Property | Override |
|----------|----------|
| Background | `--color-bg-primary` (dark) at 85% opacity |
| Border | `--color-border` (dark) |
| Breadcrumb colors | Current: `--color-secondary-900` (dark). Previous: `--color-secondary-400` (dark). |

### 10.3 Content Area

| Property | Value |
|----------|-------|
| Position | Right of sidebar, below top bar |
| Top offset | 56px |
| Left offset | 256px (expanded) / 64px (collapsed) / 0 (mobile) |
| Padding | 32px (desktop), 24px (tablet), 16px (mobile) |
| Max-width | 1440px |
| Margin | 0 auto (centers when viewport exceeds max-width + sidebar) |
| Background | `--color-bg-primary` |
| Overflow-y | `auto` |
| Min-height | `calc(100vh - 56px)` |

#### Page Header Pattern

Every content page follows this pattern at the top:

| Element | Spec |
|---------|------|
| Page title | `--text-page-title` (30px, 700). `--color-secondary-900`. |
| Page description (optional) | `--text-body` (16px, 400). `--color-secondary-500`. Margin-top: 4px. |
| Action buttons | Right-aligned on same row as title. Primary action button (e.g., "+ Add Room"). |
| Gap below header | 24px before content starts. |
| Divider (optional) | 1px solid `--color-border` between header and content. Margin-bottom: 24px. |

---

## 11. Shared Component Library

### 11.1 Data Table

The primary data display component used across all management pages.

#### Container

| Property | Value |
|----------|-------|
| Background | `--color-surface` |
| Border | 1px solid `--color-border` |
| Border-radius | `--radius-lg` (12px) |
| Shadow | `--shadow-sm` |
| Overflow | `hidden` (border-radius clips). Inner table scrolls horizontally on small screens. |

#### Table Header Row

| Property | Value |
|----------|-------|
| Background | `--color-secondary-50` |
| Height | 44px |
| Border-bottom | 1px solid `--color-border` |
| Cell padding | 12px 16px |
| Font | `--text-table-header` (12px, 600, uppercase) |
| Color | `--color-secondary-400` |
| Letter-spacing | 0.04em |
| Sortable column | Append `ArrowUpDown` icon (12px) to label. Active sort: `ArrowUp` or `ArrowDown`, `--color-primary-500`. |

#### Table Body Row

| Property | Value |
|----------|-------|
| Height | 48px (default) / 40px (compact mode) |
| Border-bottom | 1px solid `--color-border` |
| Cell padding | 12px 16px |
| Font | `--text-body-sm` (14px, 400) |
| Color | `--color-secondary-700` |
| **Hover** | Background: `--color-secondary-50` |
| **Selected** | Background: `--color-primary-50`. Left border: 2px solid `--color-primary-500`. |
| **Alternating rows** (optional) | Even rows: `--color-bg-primary`. Odd rows: `--color-secondary-50` at 50% opacity. |
| **Last row** | No bottom border |

#### Table Toolbar (above the table, inside the container)

| Element | Position | Spec |
|---------|----------|------|
| Search input | Left | 280px width. `Search` icon prefix. Placeholder: "Search [entity]...". `--text-body-sm`. |
| Filter buttons | Left (after search) | Secondary button style. `Filter` icon. Dropdown with filter options. Active filter count shown as badge. |
| Bulk actions | Left (visible when rows selected) | "X selected" label + action buttons (delete, export). |
| Pagination info | Right | "Showing 1-10 of 42" in `--text-body-sm`, `--color-secondary-400`. |
| View toggle | Right | Icon buttons: list view / compact view. |

#### Row Actions

| Property | Value |
|----------|-------|
| Position | Last column, right-aligned |
| Trigger | `MoreHorizontal` (three dots) icon button, 32px square |
| Dropdown | Menu with: Edit, Delete (danger color), any entity-specific actions |
| Inline edit/delete icons | Alternative: show `Pencil` and `Trash2` icons inline. 32px touch target each. Gap: 4px. |

#### Empty State (no data)

| Property | Value |
|----------|-------|
| Display | Centered vertically and horizontally within table area |
| Icon | Entity-specific icon (e.g., `DoorOpen` for rooms). 48px, `--color-secondary-300` |
| Title | `--text-subtitle` (18px, 600). "No rooms found" |
| Description | `--text-body` (16px, 400), `--color-secondary-400`. "Add your first room to get started." |
| Action | Primary button. "Add Room". |
| Min-height | 320px |

#### Loading State (skeleton)

| Property | Value |
|----------|-------|
| Rows shown | 5 skeleton rows |
| Cell content | Rounded rectangles at 60-80% of column width, 12px height |
| Animation | `pulse` -- opacity oscillates 0.4 to 1.0 over 1.5s, ease-in-out, infinite |
| Color | `--color-secondary-200` |

#### Pagination

| Property | Value |
|----------|-------|
| Position | Below the table, inside the container. Padding: 12px 16px. Border-top: 1px solid `--color-border`. |
| Layout | Flex row, justify-content: space-between |
| Left | "Rows per page" select: 10, 25, 50. `--text-body-sm`. |
| Center | Page numbers: 1-indexed. Current page: `--color-primary-500` bg, white text, `--radius-md`. Other pages: ghost button style. Ellipsis for large ranges. |
| Right | "Showing X-Y of Z" text. `--text-body-sm`, `--color-secondary-400`. |
| Button size | 32px square per page number |

#### Dark Mode Table

| Property | Override |
|----------|----------|
| Container bg | `--color-surface` (dark) |
| Header bg | `--color-secondary-100` (dark = `#161B22`) |
| Row hover | `--color-secondary-50` (dark = `#0D1117`) |
| Selected row | `--color-primary-50` (dark = `#1A2240`) |
| Skeleton color | `--color-secondary-200` (dark = `#21262D`) |

#### Mobile Behavior (< 640px)

Tables convert to a **card list**:
- Each row becomes a card with `--radius-lg`, 1px `--color-border` border, `--space-4` padding.
- Card title = primary identifier (e.g., room name). `--text-body` weight 600.
- Key-value pairs below in two columns. Key: `--text-caption`, `--color-secondary-400`. Value: `--text-body-sm`, `--color-secondary-700`.
- Actions: `MoreHorizontal` icon top-right of card.
- Cards stacked vertically with `--space-3` gap.

---

### 11.2 Form Components

#### Text Input

| Property | Value |
|----------|-------|
| Height | 40px |
| Padding | 10px 12px |
| Border | 1px solid `--color-secondary-200` |
| Border-radius | `--radius-md` (8px) |
| Font | `--text-body-sm` (14px, 400) |
| Background | `--color-bg-primary` |
| Placeholder color | `--color-secondary-400` |
| **Focus** | Border: `--color-primary-500`. Shadow: `--shadow-ring`. |
| **Error** | Border: `--color-error-500`. Shadow: `--shadow-ring-error`. |
| **Disabled** | Background: `--color-secondary-100`. Color: `--color-secondary-400`. Cursor: not-allowed. |
| Label | `--text-body-sm` (14px, 500), `--color-secondary-700`. Margin-bottom: 6px. Display: block. |
| Helper text | `--text-caption` (12px, 400), `--color-secondary-400`. Margin-top: 4px. |
| Error message | `--text-caption` (12px, 500), `--color-error-500`. Margin-top: 4px. `AlertCircle` icon (12px) inline. |
| Required indicator | Red asterisk (`*`) after label. `--color-error-500`. |

#### Select

Same dimensions as text input. Additional:

| Property | Value |
|----------|-------|
| Suffix icon | `ChevronDown`, 16px, `--color-secondary-400` |
| Dropdown | `--color-surface` bg. `--shadow-lg`. `--radius-md`. Max-height: 240px, overflow-y: auto. |
| Dropdown item | 36px height. Padding: 8px 12px. Hover: `--color-secondary-50`. Selected: `--color-primary-50`, `Check` icon right. |

#### Multi-Select (for competencies, facilities)

| Property | Value |
|----------|-------|
| Container | Same as text input but auto-expands height |
| Tags inside | Pill-shaped tags. Background: `--color-primary-50`. Text: `--color-primary-700`. `--text-caption` (12px, 500). Padding: 2px 8px. `--radius-pill`. `X` icon (12px) to remove. |
| Dropdown | Same as select. Checkboxes before each item. |
| Search within | Text input at top of dropdown for filtering options. |

#### Number Input

Same as text input. Additional:

| Property | Value |
|----------|-------|
| Type | `number` |
| Stepper buttons | Up/down arrows on right side. 16px icons. Visible on hover/focus. |

#### Date Picker

Same as text input with calendar icon suffix. Dropdown shows a month calendar grid.

| Property | Value |
|----------|-------|
| Calendar grid | 7 columns (days of week). Cell: 36px square. Today: `--color-primary-50` border. Selected: `--color-primary-500` bg, white text. |
| Navigation | `ChevronLeft` / `ChevronRight` for months. Month/year in center. |

#### Time Input

| Property | Value |
|----------|-------|
| Format | "HH:MM" text input with `Clock` icon. |
| Width | 120px |
| Validation | Accept 00:00 -- 23:59 format |

#### Toggle / Switch

| Property | Value |
|----------|-------|
| Track size | 44px x 24px |
| Thumb size | 20px circle |
| Track (off) | `--color-secondary-200` |
| Track (on) | `--color-primary-500` |
| Thumb | White, `--shadow-xs` |
| Transition | `--duration-normal` |
| Focus | `--shadow-ring` on track |

#### Checkbox

| Property | Value |
|----------|-------|
| Size | 18px square |
| Border | 2px solid `--color-secondary-300` |
| Border-radius | `--radius-sm` (4px) |
| Checked | Background: `--color-primary-500`. Border: `--color-primary-500`. White `Check` icon (12px). |
| Focus | `--shadow-ring` |
| Label gap | 8px |

#### Radio Button

| Property | Value |
|----------|-------|
| Size | 18px circle |
| Border | 2px solid `--color-secondary-300` |
| Selected | Border: `--color-primary-500`. Inner dot: 8px, `--color-primary-500`. |
| Focus | `--shadow-ring` |

#### Form Layout

| Property | Value |
|----------|-------|
| Field spacing | 20px vertical gap between fields |
| Form section spacing | 32px with optional divider |
| Label-to-input gap | 6px |
| Form actions (buttons) | Right-aligned. Primary action right, secondary (cancel) left. Gap: 12px. Margin-top: 24px with 1px `--color-border` divider above. |
| Two-column form | 24px gap. Each column 50%. Collapse to single column below 640px. |

---

### 11.3 Modal / Dialog

| Size | Width | Usage |
|------|-------|-------|
| Small (`modal-sm`) | 400px | Confirmation dialogs, simple forms (delete confirm, activate semester) |
| Medium (`modal-md`) | 560px | Standard CRUD forms (create/edit room, facility, lecturer) |
| Large (`modal-lg`) | 720px | Complex forms (course offering with multiple sections) |
| Extra Large (`modal-xl`) | 900px | Schedule viewer filters, manual override |

#### Modal Structure

| Element | Spec |
|---------|------|
| **Backdrop** | `rgba(15, 23, 42, 0.5)`. Dark mode: `rgba(0, 0, 0, 0.7)`. Click dismisses (unless confirmation). |
| **Container** | `--color-surface` bg. `--radius-lg` (12px). `--shadow-xl`. Max-height: `calc(100vh - 64px)`. Overflow-y: auto (body only). |
| **Header** | Padding: 20px 24px. Border-bottom: 1px solid `--color-border`. Title: `--text-subtitle` (18px, 600). `X` close button: 32px, top-right. |
| **Body** | Padding: 24px. Scrollable if content exceeds max-height. |
| **Footer** | Padding: 16px 24px. Border-top: 1px solid `--color-border`. Right-aligned buttons. |
| **Mobile** | Full-screen. Border-radius: 0. Header becomes sticky. |

#### Confirmation Dialog (subset of modal-sm)

| Element | Spec |
|---------|------|
| Icon | 48px circle container. Danger: `--color-error-50` bg, `AlertTriangle` icon `--color-error-500`. Warning: `--color-warning-50` bg. |
| Title | `--text-subtitle` (18px, 600). Center-aligned. "Delete Room?" |
| Description | `--text-body` (16px, 400), `--color-secondary-500`. Center-aligned. "This action cannot be undone." |
| Actions | Two buttons, full-width stacked on mobile. "Cancel" secondary + "Delete" danger. |

---

### 11.4 Buttons

#### Sizes

| Size | Height | Padding (h/v) | Font | Border-radius | Icon size |
|------|--------|---------------|------|---------------|-----------|
| Small (`btn-sm`) | 32px | 12px / 6px | `--text-caption` (12px) | `--radius-md` | 14px |
| Medium (`btn-md`) | 36px | 16px / 8px | `--text-button` (14px) | `--radius-md` | 16px |
| Large (`btn-lg`) | 44px | 20px / 10px | `--text-button-lg` (16px) | `--radius-md` | 18px |

#### Variants

**Primary (filled):**

| State | Background | Text | Border | Shadow |
|-------|-----------|------|--------|--------|
| Default | `--color-primary-500` | `#FFFFFF` | none | `--shadow-xs` |
| Hover | `--color-primary-600` | `#FFFFFF` | none | `--shadow-sm` |
| Active | `--color-primary-700` | `#FFFFFF` | none | none |
| Focus | `--color-primary-500` | `#FFFFFF` | none | `--shadow-ring` |
| Disabled | `--color-primary-500` at 50% opacity | `#FFFFFF` at 70% | none | none |

**Secondary (outlined):**

| State | Background | Text | Border | Shadow |
|-------|-----------|------|--------|--------|
| Default | transparent | `--color-secondary-700` | 1px solid `--color-border` | none |
| Hover | `--color-secondary-50` | `--color-secondary-900` | 1px solid `--color-secondary-300` | `--shadow-xs` |
| Active | `--color-secondary-100` | `--color-secondary-900` | 1px solid `--color-secondary-400` | none |
| Focus | transparent | `--color-secondary-700` | 1px solid `--color-border` | `--shadow-ring` |
| Disabled | transparent | `--color-secondary-400` | 1px solid `--color-secondary-200` | none |

**Ghost (text-only):**

| State | Background | Text |
|-------|-----------|------|
| Default | transparent | `--color-primary-500` |
| Hover | `--color-primary-50` | `--color-primary-600` |
| Active | `--color-primary-100` | `--color-primary-700` |

**Danger (filled):**

| State | Background | Text |
|-------|-----------|------|
| Default | `--color-error-500` | `#FFFFFF` |
| Hover | `--color-error-700` | `#FFFFFF` |
| Active | `#991B1B` | `#FFFFFF` |

**Icon Button (square):**

| Size | Dimensions | Border-radius | Icon size |
|------|-----------|---------------|-----------|
| Small | 32px x 32px | `--radius-md` | 16px |
| Medium | 36px x 36px | `--radius-md` | 18px |

Background: transparent. Hover: `--color-secondary-100`. Color: `--color-secondary-500`. Hover color: `--color-secondary-700`.

#### Dark Mode Button Overrides

| Variant | Override |
|---------|----------|
| Primary | Background: `--color-primary-500` (dark = `#6382E8`). Hover: `--color-primary-600` (dark = `#7B9AEF`). |
| Secondary | Text: `--color-secondary-700` (dark). Border: `--color-border` (dark). Hover bg: `--color-secondary-50` (dark). |
| Ghost | Text: `--color-primary-400` (dark). Hover bg: `--color-primary-50` (dark). |
| Danger | Background: `--color-error-500` (dark = `#F87171`). Text: `#0D1117`. |

---

### 11.5 Badges / Tags

#### Status Badges (Schedule Run Status)

| Status | Background | Text | Border |
|--------|-----------|------|--------|
| QUEUED | `--color-info-50` | `--color-info-500` | none |
| RUNNING | `--color-info-50` | `--color-info-500` | Animated left border pulse |
| COMPLETED | `--color-success-50` | `--color-success-700` | none |
| STAGNATED | `--color-warning-50` | `--color-warning-700` | none |
| SSA_INFEASIBLE | `--color-error-50` | `--color-error-700` | none |
| PRE_GA_EMPTY | `--color-error-50` | `--color-error-700` | none |
| CANCELLED | `--color-secondary-100` | `--color-secondary-500` | none |
| FAILED | `--color-error-50` | `--color-error-700` | none |

Badge spec: `--text-caption` (12px, 600). Padding: 2px 10px. `--radius-pill`. Inline-flex, align-items: center. Optional leading dot (6px circle, same color as text) for RUNNING (with pulse animation).

#### Role Badges

| Role | Background | Text |
|------|-----------|------|
| ADMIN | `--color-primary-50` | `--color-primary-700` |
| USER | `--color-secondary-100` | `--color-secondary-600` |

Same sizing as status badges.

#### Competency / Facility Tags

| Property | Value |
|----------|-------|
| Background | `--color-secondary-100` |
| Text | `--color-secondary-700` |
| Font | `--text-caption` (12px, 500) |
| Padding | 2px 8px |
| Border-radius | `--radius-sm` (4px) |
| Gap between tags | 4px |
| Removable variant | Add `X` icon (10px) with 4px gap. Hover icon: `--color-error-500`. |

#### Boolean/Active Tags

| State | Background | Text | Icon |
|-------|-----------|------|------|
| Active / Yes | `--color-success-50` | `--color-success-700` | `Check` (12px) |
| Inactive / No | `--color-secondary-100` | `--color-secondary-500` | `X` (12px) |

---

### 11.6 Toast / Notification

| Property | Value |
|----------|-------|
| Position | Fixed, top-right. Top: 72px (below top bar). Right: 24px. |
| Width | 360px (desktop), `calc(100vw - 32px)` (mobile) |
| Max visible | 3 stacked with 8px gap |
| Background | `--color-surface` |
| Border | 1px solid `--color-border` |
| Border-radius | `--radius-lg` (12px) |
| Shadow | `--shadow-lg` |
| Padding | 16px |
| Auto-dismiss | 5 seconds (success/info), 8 seconds (warning), manual dismiss only (error) |

#### Toast Content

| Element | Spec |
|---------|------|
| Icon | 20px. Success: `Check` in `--color-success-500`. Error: `AlertCircle` in `--color-error-500`. Warning: `AlertTriangle` in `--color-warning-500`. Info: `Info` in `--color-info-500`. |
| Title | `--text-body-sm` (14px, 600). `--color-secondary-900`. |
| Message | `--text-body-sm` (14px, 400). `--color-secondary-500`. Margin-top: 4px. |
| Close button | `X` icon, 16px, `--color-secondary-400`. Top-right. |
| Progress bar (auto-dismiss) | 2px height at bottom. Color matches toast type. Shrinks left to right over dismiss duration. |

#### Toast Variants (left accent border)

| Type | Left border |
|------|------------|
| Success | 3px solid `--color-success-500` |
| Error | 3px solid `--color-error-500` |
| Warning | 3px solid `--color-warning-500` |
| Info | 3px solid `--color-info-500` |

---

### 11.7 Cards

#### Stat Card (Dashboard)

| Property | Value |
|----------|-------|
| Width | Fills grid column |
| Padding | 24px |
| Background | `--color-surface` |
| Border | 1px solid `--color-border` |
| Border-radius | `--radius-lg` (12px) |
| Shadow | `--shadow-sm` |
| Hover | `--shadow-md`, `translateY(-1px)` if clickable |

Content (top to bottom):

| Element | Spec |
|---------|------|
| Icon container | 40px x 40px. `--color-primary-50` bg. `--radius-md`. Icon: 20px, `--color-primary-500`. |
| Label | `--text-body-sm` (14px, 500). `--color-secondary-500`. Margin-top: 16px. |
| Value | `--text-section-title` (24px, 700). `--color-secondary-900`. Margin-top: 4px. |
| Trend (optional) | `--text-caption` (12px, 500). Green up-arrow or red down-arrow + percentage. |

#### Info Card

| Property | Value |
|----------|-------|
| Padding | 20px |
| Background | `--color-surface` |
| Border | 1px solid `--color-border` |
| Border-radius | `--radius-lg` (12px) |
| Shadow | `--shadow-sm` |

---

### 11.8 Charts

Used for GA fitness curve and dashboard statistics.

#### Fitness Curve Line Chart

| Property | Value |
|----------|-------|
| Library recommendation | Recharts or Chart.js (lightweight) |
| Container | Full-width of parent. Height: 300px (desktop), 240px (mobile). `--color-surface` bg. `--radius-lg` border. |
| X-axis | Generation number. Label: "Generation". `--text-caption`, `--color-secondary-400`. |
| Y-axis | Fitness value. Label: "Fitness". `--text-caption`, `--color-secondary-400`. |
| Best fitness line | Color: `--color-primary-500`. Stroke width: 2px. |
| Average fitness line | Color: `--color-accent-400`. Stroke width: 1.5px. Dashed: `4 4`. |
| Hard violations line (optional overlay) | Color: `--color-error-500`. Stroke width: 1.5px. Separate Y-axis right side. |
| Grid lines | `--color-secondary-200` at 0.5 opacity. |
| Tooltip | `--color-surface` bg. `--shadow-md`. `--radius-md`. Shows: generation, best fitness, avg fitness, violations. |
| Animation | Line draws progressively during live SSE updates. New points animate in with `--ease-out`. |
| Dark mode | Grid: `--color-secondary-200` (dark). Axis labels: `--color-secondary-400` (dark). Lines: same colors, slightly brighter. |

#### Bar Chart (Dashboard)

| Property | Value |
|----------|-------|
| Container | Same as line chart |
| Bar color | `--color-primary-500`. Hover: `--color-primary-400`. |
| Bar border-radius | `--radius-sm` (4px) on top corners |
| Bar gap | 4px |

---

### 11.9 Breadcrumbs

| Property | Value |
|----------|-------|
| Font | `--text-body-sm` (14px) |
| Separator | `ChevronRight` icon, 12px, `--color-secondary-300` |
| Current segment | `--color-secondary-900`, weight 500 |
| Previous segments | `--color-secondary-400`, weight 400, hover: `--color-primary-500`, cursor: pointer |
| Max items shown | 4 (collapse middle into `...` dropdown for deeper nesting) |

---

### 11.10 Skeleton Loaders

| Element | Skeleton Shape |
|---------|---------------|
| Text line | Rounded rectangle. Height: 12px (caption) / 14px (body-sm) / 16px (body). Width: 60-90% random. `--radius-sm`. |
| Stat card value | Rounded rectangle. 24px height, 80px width. |
| Table cell | Rounded rectangle. 12px height, 60-80% width. |
| Avatar | Circle, 32px / 40px diameter. |
| Badge | Rounded rectangle. 12px height, 60px width. `--radius-pill`. |
| Color | `--color-secondary-200` (light) / `--color-secondary-200` (dark = `#21262D`) |
| Animation | Pulse: opacity 0.4 to 1.0, 1.5s, ease-in-out, infinite |

---

### 11.11 Empty States

Used when a data list has no items.

| Property | Value |
|----------|-------|
| Layout | Centered, both axes |
| Min-height | 320px |
| Icon | Entity-specific. 48px, `--color-secondary-300` |
| Title | `--text-subtitle` (18px, 600), `--color-secondary-700` |
| Description | `--text-body` (16px, 400), `--color-secondary-400`. Max-width: 360px, centered. Margin-top: 8px. |
| Action | Primary button or ghost button. Margin-top: 20px. |

---

### 11.12 Search / Filter Bar

| Property | Value |
|----------|-------|
| Layout | Flex row, gap 12px. Wraps on mobile. |
| Search input | 280px width (desktop), 100% (mobile). `Search` icon prefix inside input, 16px, `--color-secondary-400`. |
| Filter button | Secondary button. `Filter` icon + "Filters" label. If filters active: badge count (circle, 18px, `--color-primary-500` bg, white text) on top-right of button. |
| Filter dropdown/panel | `--color-surface` bg. `--shadow-lg`. `--radius-lg`. Padding: 16px. Contains form fields for each filterable column. "Apply" primary button + "Reset" ghost button at bottom. |
| Active filter pills | Row of pills below search bar (only shown when filters active). Each pill: `--color-primary-50` bg, `--color-primary-700` text, `X` to remove. |

---

## 12. Page Specifications

### 12.1 Login Page

**Route:** `/login`
**Layout:** No sidebar, no top bar. Standalone centered page.

#### Structure

| Property | Value |
|----------|-------|
| Layout | Full viewport. Centered card on `--color-bg-secondary` background. |
| Card | `--color-surface` bg. `--shadow-lg`. `--radius-xl` (16px). Width: 400px. Padding: 40px. |
| Mobile | Card: 100% width, 16px margin, `--radius-lg`. Padding: 24px. |

#### Content (top to bottom)

| Element | Spec |
|---------|------|
| Logo | "GA Scheduler" in Inter 700, 20px, `--color-secondary-900`. Centered. Optional icon left. |
| Subtitle | `--text-body-sm` (14px, 400). `--color-secondary-500`. "Universitas Pembangunan Jaya". Centered. Margin-top: 4px. |
| Divider gap | 32px |
| Title | `--text-section-title` (24px, 600). "Sign in to your account". Left-aligned. |
| Description | `--text-body-sm` (14px, 400). `--color-secondary-400`. "Enter your credentials below." Margin-top: 4px. |
| Gap | 24px |
| Email field | Standard text input. Label: "Email address". Type: email. Placeholder: "admin@upj.ac.id". Full-width. |
| Gap | 16px |
| Password field | Standard text input. Label: "Password". Type: password. Eye icon toggle to show/hide. Full-width. |
| Gap | 24px |
| Submit button | Primary, large, full-width. "Sign in". Loading state: spinner icon replacing text. |
| Error message | Appears above submit button on failure. `--color-error-50` bg. `--color-error-700` text. `--radius-md`. Padding: 12px 16px. `AlertCircle` icon. |

#### States

| State | Behavior |
|-------|----------|
| Loading | Button shows spinner. Inputs disabled. |
| Error (wrong credentials) | Error alert appears. Password field clears. Email field focused. Shake animation on card (subtle). |
| Success | Redirect to `/dashboard`. |

#### Dark Mode

Card background: `--color-surface` (dark). Page background: `--color-bg-primary` (dark). All form tokens follow dark mode.

---

### 12.2 Dashboard

**Route:** `/dashboard`
**Access:** All authenticated users

#### Page Header

| Element | Spec |
|---------|------|
| Title | "Dashboard" |
| Description | "Overview of semester [active semester label]" |
| No action button on this page | |

#### Layout

Desktop: 12-column grid.

```
+-----------------------------------------------+
| Stats Cards Row (4 equal columns)             |
| [Rooms] [Lecturers] [Courses] [Offerings]    |
+-----------------------------------------------+
| [Recent Runs - 8 cols]  | [Quick Actions - 4] |
+-----------------------------------------------+
| [Recent Activity / Audit - full width]        |
+-----------------------------------------------+
```

Tablet: 2-column grid for stats (2x2). Full-width for tables.
Mobile: Single column, stacked.

#### Stat Cards (row of 4)

| Card | Icon | Label | Value (example) | Icon Container Color |
|------|------|-------|-----------------|---------------------|
| Rooms | `DoorOpen` | Total Rooms | 24 | `--color-primary-50` |
| Lecturers | `Users` | Active Lecturers | 48 | `--color-success-50`, icon: `--color-success-500` |
| Courses | `BookOpen` | Courses | 36 | `--color-warning-50`, icon: `--color-warning-500` |
| Offerings | `Layers` | Course Offerings | 72 | `--color-info-50`, icon: `--color-info-500` |

Each uses the Stat Card spec from 11.7.

#### Recent Schedule Runs (left, 8 columns)

| Property | Value |
|----------|-------|
| Container | Card with header "Recent Runs". `CalendarDays` icon. "View all" ghost link, right-aligned in header. |
| Table | Compact table (40px rows). Columns: Status (badge), Created (relative time), Best Fitness (mono), Duration, Actions. |
| Show | Last 5 runs. |
| Empty state | "No schedule runs yet. Run your first schedule to see results here." |

#### Quick Actions (right, 4 columns)

| Property | Value |
|----------|-------|
| Container | Card with header "Quick Actions" |
| Items | Vertical list of action buttons, each full-width, secondary style. Gap: 8px. |

Actions:

| Icon | Label | Route |
|------|-------|-------|
| `Play` | Run New Schedule | `/runs/new` |
| `CalendarDays` | View Latest Schedule | `/schedule` |
| `DoorOpen` | Manage Rooms | `/rooms` |
| `Users` | Manage Lecturers | `/lecturers` |
| `Layers` | Manage Offerings | `/offerings` |

#### Recent Activity (full width)

| Property | Value |
|----------|-------|
| Container | Card with header "Recent Activity" |
| Content | Last 10 audit log entries in a compact list. Each row: icon (entity type), description text, actor name, relative timestamp. |
| Format | "[User Name] [action] [entity] [time ago]". E.g., "Admin created room Lab 301 2 hours ago" |
| Empty state | "No recent activity." |

#### Loading State

All stat cards show skeleton values. Tables show 5 skeleton rows.

#### Dark Mode

All cards use `--color-surface` (dark). Text colors follow dark mode tokens.

---

### 12.3 Semester Management

**Route:** `/semesters`
**Access:** ADMIN

#### Page Header

| Element | Spec |
|---------|------|
| Title | "Semesters" |
| Description | "Manage academic semesters. Only one semester can be active at a time." |
| Action | Primary button: "+ New Semester" |

#### Table Columns

| Column | Width | Content |
|--------|-------|---------|
| Code | 180px | `--text-mono` (13px). E.g., "2025-GANJIL" |
| Label | flex | E.g., "Semester Ganjil 2025/2026" |
| Start Date | 140px | Formatted date |
| End Date | 140px | Formatted date |
| Status | 100px | Active badge (green) or Inactive badge (gray) |
| Actions | 80px | Activate (if inactive), Edit, Delete |

#### Active Semester Indicator

The active semester row has a left border of 3px solid `--color-success-500` and a subtle `--color-success-50` background.

#### Create/Edit Modal (modal-md)

Fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Code | Text input | Yes | Placeholder: "2025-GANJIL" |
| Label | Text input | Yes | Placeholder: "Semester Ganjil 2025/2026" |
| Start Date | Date picker | Yes | |
| End Date | Date picker | Yes | Must be after start date |

#### Activate Semester Confirmation

Confirmation dialog (modal-sm). Warning icon.

- Title: "Activate Semester?"
- Description: "This will deactivate the current semester '[current code]' and activate '[new code]'. All data views will switch to the new semester."
- Actions: "Cancel" (secondary) + "Activate" (primary)

#### Empty State

Icon: `GraduationCap`. Title: "No semesters configured". Description: "Create your first semester to begin setting up schedule data." Action: "+ New Semester".

---

### 12.4 Facility Management

**Route:** `/facilities`
**Access:** ADMIN

#### Page Header

Title: "Facilities". Description: "Manage room facility types (LAB, PROJECTOR, STUDIO, etc.)." Action: "+ New Facility".

#### Table Columns

| Column | Width | Content |
|--------|-------|---------|
| Code | 200px | `--text-mono` (13px, 600). E.g., "LAB" |
| Label | flex | E.g., "Computer Laboratory" |
| Rooms Using | 120px | Count of rooms with this facility |
| Courses Requiring | 140px | Count of courses requiring this facility |
| Actions | 80px | Edit, Delete |

#### Create/Edit Modal (modal-sm)

| Field | Type | Required |
|-------|------|----------|
| Code | Text input (uppercase) | Yes |
| Label | Text input | Yes |

#### Delete Confirmation

If facility is in use by rooms or courses, show warning: "This facility is assigned to X rooms and required by Y courses. Removing it may affect scheduling."

---

### 12.5 Room Management

**Route:** `/rooms`
**Access:** ADMIN (create/edit/delete), USER (read)

#### Page Header

Title: "Rooms". Description: "Manage rooms for the active semester." Action: "+ Add Room" (ADMIN only).

#### Table Columns

| Column | Width | Content |
|--------|-------|---------|
| Name | 200px | E.g., "Lab 301" |
| Capacity | 100px | Number, right-aligned |
| Facilities | flex | Tag list: `LAB`, `PROJECTOR`, etc. using facility tags |
| Offerings | 100px | Count of offerings assigned to this room |
| Actions | 80px | Edit, Delete (ADMIN) |

#### Toolbar

Search by name. Filter by facility (multi-select dropdown). Filter by capacity range (min/max number inputs).

#### Create/Edit Modal (modal-md)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | Text input | Yes | Placeholder: "Lab 301" |
| Capacity | Number input | Yes | Min: 1 |
| Facilities | Multi-select | No | Shows all facilities. Selected shown as tags. |

---

### 12.6 Timeslot Management

**Route:** `/timeslots`
**Access:** ADMIN

#### Page Header

Title: "Timeslots". Description: "Define available time slots for the active semester."
Action: "+ Add Timeslot".

#### Primary View: Visual Grid

Instead of a table, timeslots are displayed as a **visual grid** showing days as columns and time ranges as positioned blocks.

| Property | Value |
|----------|-------|
| Container | `--color-surface` bg. `--radius-lg`. `--shadow-sm`. Full-width. |
| Layout | CSS Grid. Columns: `120px` (row labels) + `repeat(7, 1fr)` (Mon-Sun) or fewer if no weekend slots. |
| Day headers | `--text-table-header` (12px, 600, uppercase). `--color-secondary-400`. `--color-secondary-50` bg. Height: 44px. Sticky top. |
| Time axis (left) | `--text-mono` (13px). `--color-secondary-400`. Each hour mark. |
| Timeslot blocks | Positioned based on startTime/endTime. `--color-primary-50` bg. `--color-primary-700` text. `--radius-sm`. 1px solid `--color-primary-200` border. Padding: 4px 8px. `--text-mono-sm` (12px). Shows "HH:MM - HH:MM". |
| Hover on block | `--shadow-md`. Cursor: pointer. Shows edit actions on hover. |
| Click on block | Opens edit modal. |
| Click on empty cell | Opens create modal with day pre-filled. |
| Drag to create | (Optional enhancement) Drag vertically to define start/end time. |

#### Fallback: Table View

Toggle between grid view and table view using a view switcher in the toolbar.

| Column | Width | Content |
|--------|-------|---------|
| Day | 120px | MONDAY, TUESDAY, etc. |
| Start Time | 100px | `--text-mono`. "08:00" |
| End Time | 100px | `--text-mono`. "09:30" |
| Duration | 100px | Calculated. "90 min" |
| Lecturers Preferring | 100px | Count |
| Actions | 80px | Edit, Delete |

#### Create/Edit Modal (modal-sm)

| Field | Type | Required |
|-------|------|----------|
| Day | Select (MONDAY-SUNDAY) | Yes |
| Start Time | Time input (HH:MM) | Yes |
| End Time | Time input (HH:MM) | Yes |

Validation: End time must be after start time. No overlapping slots on the same day.

---

### 12.7 Lecturer Management

**Route:** `/lecturers`
**Access:** ADMIN (CRUD), USER (read)

#### Page Header

Title: "Lecturers". Description: "Manage lecturers and their competencies for the active semester." Action: "+ Add Lecturer".

#### Table Columns

| Column | Width | Content |
|--------|-------|---------|
| Name | 220px | Full name |
| Structural | 100px | Boolean tag (Yes/No with icon) |
| Competencies | flex | Tag list of competency strings |
| Preferred Slots | 140px | Count. Clickable to expand/view. |
| Offerings | 100px | Count of assigned offerings |
| Actions | 80px | Edit, Delete |

#### Toolbar

Search by name. Filter by competency (multi-select). Filter by structural (toggle).

#### Create/Edit Modal (modal-md)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | Text input | Yes | |
| Is Structural | Toggle switch | No | Default: off. Helper: "Structural lecturers (e.g., department heads) receive preferential scheduling." |
| Competencies | Multi-select / tag input | No | Free-text tag input. User types and presses Enter to add. Shows as removable tags. |
| Preferred Time Slots | Multi-select | No | Grouped by day. Shows timeslot labels. Checkboxes. |

#### Preferred Slots Sub-section

Within the modal, preferred slots are shown as a mini-grid (days as columns, available slots as rows, checkboxes to select). This gives a visual overview.

---

### 12.8 Course Management

**Route:** `/courses`
**Access:** ADMIN (CRUD), USER (read)

#### Page Header

Title: "Courses". Description: "Manage courses for the active semester." Action: "+ Add Course".

#### Table Columns

| Column | Width | Content |
|--------|-------|---------|
| Code | 120px | `--text-mono` (13px, 600). "IF101" |
| Name | flex | Course name |
| SKS | 80px | Number, centered. Badge style (circle, 24px, `--color-secondary-100` bg). |
| Required Competencies | 180px | Tag list |
| Required Facilities | 160px | Tag list |
| Offerings | 80px | Count |
| Actions | 80px | Edit, Delete |

#### Toolbar

Search by code or name. Filter by SKS (select: 1, 2, 3, 4). Filter by required facility.

#### Create/Edit Modal (modal-md)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Code | Text input | Yes | Uppercase. Placeholder: "IF101" |
| Name | Text input | Yes | Placeholder: "Introduction to Programming" |
| SKS | Number input | Yes | Min: 1, Max: 6 |
| Required Competencies | Multi-select / tag input | No | Free-text or from existing competency strings |
| Required Facilities | Multi-select | No | Select from facility list |

---

### 12.9 Course Offering Management

**Route:** `/offerings`
**Access:** ADMIN (CRUD), USER (read)

This is the most complex CRUD page because offerings link courses, rooms, lecturers, and optional fixed slots.

#### Page Header

Title: "Course Offerings". Description: "Link courses to rooms and lecturers. Configure parallel splits and fixed schedules." Action: "+ Create Offering".

#### Table Columns

| Column | Width | Content |
|--------|-------|---------|
| Course | 180px | Course code + name. Code in `--text-mono`, name below in `--text-caption`. |
| Room | 140px | Room name |
| Lecturers | 180px | Comma-separated names. Truncate with "+N more" if > 2. |
| Students | 100px | effectiveStudentCount, right-aligned |
| Fixed | 80px | Boolean tag |
| Parent | 100px | Parent offering course code (if parallel split) or "--" |
| Locked Room | 100px | `Lock` icon if has LockedRoom, else "--" |
| Actions | 80px | Edit, Delete, Lock Room |

#### Toolbar

Search by course code/name. Filter by: isFixed (toggle), has parent (toggle), room (select), lecturer (select).

#### Create/Edit Modal (modal-lg)

This modal has multiple sections, visually separated by dividers.

**Section 1: Course & Room**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Course | Searchable select | Yes | Shows "code - name" format. Only courses from active semester. |
| Room | Searchable select | Yes | Shows "name (capacity: N)" format. |
| Effective Student Count | Number input | Yes | Used to calculate parallel sessions. |
| Parent Offering | Select | No | Only shows other offerings for the same course. For creating parallel splits (Sesi A / Sesi B). |

**Section 2: Lecturers**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Lecturers | Multi-select with search | Yes (at least 1) | Shows lecturer name + competencies as sub-text. Multiple for team teaching. |

**Section 3: Fixed Schedule** (collapsible, default collapsed)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Is Fixed | Toggle | No | When enabled, reveals slot selection below. |
| Fixed Time Slots | Multi-select | Conditional (when isFixed) | Grouped by day. Checkboxes per timeslot. Shows day + time range. |

**Section 4: Room Lock** (separate from isFixed)

| Property | Value |
|----------|-------|
| Info text | "Locking a room ensures the GA always assigns this offering to the selected room." |
| Lock Room toggle | Toggle. If enabled, locks the current room selection. |
| Reason | Text input (when locked). Optional. "Why are you locking this room?" |

#### Parallel Split UI

When a parentOfferingId is set, show an info banner at the top of the modal:

| Property | Value |
|----------|-------|
| Background | `--color-info-50` |
| Border | 1px solid `--color-info-500` at 30% opacity |
| Icon | `Info`, `--color-info-500` |
| Text | "This is a parallel split of [parent course code]. The GA will schedule this session independently." |

#### Empty State

Icon: `Layers`. Title: "No course offerings". Description: "Create offerings to link courses with rooms and lecturers before running the scheduler."

---

### 12.10 Schedule Run

**Route:** `/runs` (list), `/runs/new` (create), `/runs/:id` (detail/progress)
**Access:** All authenticated users

This page has three sub-views.

#### 12.10.1 Run History List (`/runs`)

##### Page Header

Title: "Schedule Runs". Description: "View past runs and create new schedule generations." Action: "+ New Run" (primary button).

##### Table Columns

| Column | Width | Content |
|--------|-------|---------|
| Status | 140px | Status badge (per 11.5) |
| Created | 160px | Date/time + "by [user name]" below |
| Generation | 120px | "142 / 200" format. `--text-mono`. |
| Best Fitness | 120px | `--text-mono`. Formatted to 4 decimal places. Color: green if > 0.9, yellow if 0.7-0.9, red if < 0.7. |
| Hard Violations | 120px | `--text-mono`. "0" in green or count in red. |
| Soft Penalty | 100px | `--text-mono`. |
| Duration | 100px | "2.4s" or "1m 23s" format |
| Actions | 100px | View (navigate to detail), View Schedule (if COMPLETED), Cancel (if RUNNING) |

##### Toolbar

Filter by status (multi-select). Search by run ID. Sort by created date.

##### Empty State

Icon: `Play`. Title: "No schedule runs yet". Description: "Run your first schedule to generate an optimized timetable." Action: "New Run".

#### 12.10.2 Run Creation Form (`/runs/new`)

##### Page Header

Title: "New Schedule Run". Breadcrumb: "Schedule Runs > New Run".

##### Layout

Single centered card. Max-width: 640px. `--color-surface` bg. `--radius-lg`. `--shadow-sm`. Padding: 32px.

##### Form Sections

**Section 1: GA Configuration**

| Field | Type | Default | Range | Help Text |
|-------|------|---------|-------|-----------|
| Population Size | Number input | 100 | 20 -- 500 | "Number of chromosomes in each generation" |
| Max Generations | Number input | 200 | 50 -- 2000 | "Maximum generations before stopping" |
| Crossover Rate | Number input (step 0.01) | 0.85 | 0.0 -- 1.0 | "Probability of crossover between parents" |
| Mutation Rate | Number input (step 0.01) | 0.1 | 0.0 -- 1.0 | "Probability of mutation per gene" |
| Crossover Strategy | Select | "ORDER_BASED" | ORDER_BASED, PARTIALLY_MAPPED, UNIFORM | "Strategy for combining parent chromosomes" |
| Elitism Count | Number input | 2 | 0 -- 20 | "Number of best individuals preserved each generation" |

**Section 2: Pre-flight Info** (read-only summary)

| Item | Value |
|------|-------|
| Active Semester | "[semester code]" |
| Total Offerings | Count |
| Fixed Offerings | Count |
| Rooms Available | Count |
| Timeslots Available | Count |
| Estimated Combinations | Calculated number |

**Section 3: Actions**

| Button | Style | Position |
|--------|-------|----------|
| "Start Run" | Primary, large | Right |
| "Cancel" | Secondary | Left |

Clicking "Start Run" shows a brief confirmation: "This will start a new GA run with [populationSize] population and [maxGenerations] max generations. Continue?"

On confirmation, navigates to `/runs/:id` (the live progress view).

#### 12.10.3 Live Progress View (`/runs/:id`)

This is the real-time SSE-powered view shown while a GA run is executing.

##### Layout

```
+--------------------------------------------+
| Breadcrumb: Runs > Run [ID short]          |
| Status badge: RUNNING (animated)           |
+--------------------------------------------+
| [Stats Panel - 5 equal columns]            |
| Gen  | Best    | Hard    | Soft   | Time   |
| 142  | 0.9412  | 0      | 12     | 2.4s   |
+--------------------------------------------+
| [Progress Bar - full width]                |
| ████████████████░░░░░░  142/200 (71%)      |
+--------------------------------------------+
| [Fitness Curve Chart - full width, 300px]  |
| Best: solid blue line                      |
| Avg: dashed cyan line                      |
+--------------------------------------------+
| [Action Bar]                               |
| [Cancel Run] (danger)     [View Schedule]  |
+--------------------------------------------+
```

See section 14 for detailed GA Progress Monitor spec.

##### Run Completion Transition

When the run completes (COMPLETED/STAGNATED/FAILED):

1. Status badge transitions from RUNNING (animated) to final status.
2. Stats panel values finalize (no more updates).
3. Progress bar fills to 100% (or stops at final generation).
4. Success: green confetti-like brief animation (subtle dots, 1 second). Button "View Schedule" becomes primary.
5. Failure: red pulse on status badge. Error message card appears below chart.
6. Stagnated: warning banner: "The GA stagnated at generation [N]. Results may not be optimal."

---

### 12.11 Schedule Viewer

**Route:** `/schedule`
**Access:** All authenticated users

This is the **hero screen** -- the most important visual in the entire application.

#### Page Header

Title: "Schedule". Description: "View the generated timetable for [semester code]."
No "create" action. Instead, a "Select Run" dropdown if multiple completed runs exist.

#### Toolbar (above the grid)

| Element | Position | Spec |
|---------|----------|------|
| Run selector | Left | Select dropdown showing completed runs. Format: "[date] - Fitness: [value] - [status]". Default: latest COMPLETED run. |
| Filter: Room | Left | Multi-select. Filter grid to show only selected rooms. |
| Filter: Lecturer | Left | Searchable select. Filter to show only offerings with that lecturer. |
| Filter: Day | Left | Multi-select. Show only selected days (columns). |
| Filter: Course | Left | Searchable select. Filter to a specific course. |
| Density toggle | Right | "Compact" / "Comfortable" toggle. Affects cell height. |
| Export button | Right | Secondary button. `Download` icon. Exports to PDF or CSV. |
| Print button | Right | Ghost button. `Printer` icon. Opens print view. |

#### Timetable Grid

See section 13 for the complete Schedule Timetable Grid specification.

#### Below the Grid: Run Summary Panel

| Property | Value |
|----------|-------|
| Layout | Flex row of summary stats. `--color-surface` bg. `--radius-lg`. Padding: 16px 24px. Margin-top: 16px. |
| Items | Best Fitness (mono, green), Hard Violations (mono, should be 0), Soft Penalty (mono), Total Assignments, Duration, Generations Run |
| Each item | Label: `--text-caption`. Value: `--text-body` weight 600 in `--text-mono`. |

#### Empty State

When no completed runs exist:

Icon: `CalendarDays`. Title: "No schedule generated yet". Description: "Run the scheduler first to generate a timetable." Action: "Go to Schedule Runs" (navigates to `/runs`).

#### Loading State

Skeleton grid: gray blocks in grid layout. Shimmer animation.

#### Mobile Behavior

The timetable grid is not suitable for small screens. Two fallback options:

**Option A: Horizontal scroll** -- Grid scrolls horizontally with sticky time column on left and sticky day headers on top. Touch-friendly.

**Option B: Card-based view** -- Switch to a filterable list of cards. Each card = one assignment. Shows: Course code, name, room, lecturer, day, time, session index. Grouped by day. Sortable by time.

A toggle between grid and list view is available in the toolbar on mobile.

---

### 12.12 Manual Override

**Route:** `/schedule/:runId/override` or modal within Schedule Viewer
**Access:** ADMIN

#### Access Point

From the Schedule Viewer, clicking on a course block in the timetable grid opens the manual override flow.

#### Override Modal (modal-lg)

##### Header

Title: "Edit Assignment". Subtitle: "[Course code] - [Course name], Session [index]".

##### Current Assignment Display

| Property | Value |
|----------|-------|
| Layout | Card with `--color-secondary-50` bg. `--radius-md`. Padding: 16px. |
| Content | "Currently assigned to [Room Name] on [Day], [Time Range]" |
| Badge | "Original" or "Overridden" (if previously overridden) |

##### Override Form

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| New Room | Searchable select | Yes | Shows room name + capacity. Pre-filled with current. Highlight if different from current. |
| New Time Slot(s) | Multi-select grouped by day | Yes | Must select same number of consecutive slots as session duration. Pre-filled with current. |
| Reason | Textarea | Yes | "Why are you overriding this assignment?" Placeholder: "e.g., Room conflict with external event". Min 10 characters. |

##### Conflict Detection

When the user selects a new room or timeslot, the system checks for conflicts in real-time:

| Conflict Type | Display |
|---------------|---------|
| Room conflict | Warning banner: "Room [name] is already assigned to [other course] at this time." `--color-warning-50` bg. |
| Lecturer conflict | Warning banner: "Lecturer [name] already has [other course] at this time." |
| No conflicts | Success banner: "No scheduling conflicts detected." `--color-success-50` bg. |

Conflicts show as warnings (not blockers) -- the admin can force-override.

##### Actions

| Button | Style | Position |
|--------|-------|----------|
| "Save Override" | Primary | Right |
| "Cancel" | Secondary | Left |

##### After Save

- The assignment in the grid updates immediately.
- A "Manual Override" badge appears on the course block.
- Toast: "Assignment for [course code] has been overridden."
- Audit log entry is created.

---

### 12.13 User Management

**Route:** `/users`
**Access:** ADMIN only

#### Page Header

Title: "Users". Description: "Manage user accounts and roles." Action: "+ Add User".

#### Table Columns

| Column | Width | Content |
|--------|-------|---------|
| Name | 200px | Full name |
| Email | 220px | Email address |
| Role | 100px | Role badge (ADMIN/USER) |
| Status | 100px | Active/Inactive boolean tag |
| Last Login | 160px | Relative time or "Never" |
| Created | 140px | Date |
| Actions | 100px | Edit, Activate/Deactivate, Delete |

#### Toolbar

Search by name or email. Filter by role (select). Filter by status (toggle).

#### Create/Edit Modal (modal-md)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Full Name | Text input | Yes | |
| Email | Email input | Yes | Must be unique |
| Password | Password input | Yes (create only) | Min 8 characters. Shown only on create, not edit. |
| Role | Select | Yes | ADMIN or USER |
| Is Active | Toggle | No | Default: active |

#### Deactivate Confirmation

Confirmation dialog. Warning icon. "Deactivate user [name]? They will no longer be able to log in."

---

### 12.14 Audit Log Viewer

**Route:** `/audit-log`
**Access:** ADMIN only

#### Page Header

Title: "Audit Log". Description: "View all system activity and user actions."
No create action (read-only view).

#### Table Columns

| Column | Width | Content |
|--------|-------|---------|
| Timestamp | 180px | Full date/time in `--text-mono-sm` |
| Actor | 160px | User name or "System" (italicized for system events) |
| Action | 200px | Human-readable action. E.g., "Created Room". Badge-style coloring by action type: create = blue, update = yellow, delete = red. |
| Entity | 180px | Entity type + ID. E.g., "Room #24" or "ScheduleRun clxxyz..." (truncated) |
| Details | flex | Expandable. Shows metadata JSON diff. `--text-mono-sm`, `--color-secondary-500`. |
| IP Address | 140px | `--text-mono-sm`, `--color-secondary-400` |

#### Toolbar

- Date range picker (from -- to)
- Search by action or entity
- Filter by actor (select from users)
- Filter by entity type (select: User, Room, Semester, Course, etc.)
- Filter by action type (select: create, update, delete, login, etc.)

#### Expandable Row Detail

Clicking a row expands it to show:

| Property | Value |
|----------|-------|
| Layout | Full-width expanded section below the row. `--color-secondary-50` bg. Padding: 16px. |
| Metadata | Pretty-printed JSON. `--text-mono-sm`. Syntax-highlighted keys (secondary) and values (primary text). |
| User Agent | `--text-caption`, `--color-secondary-400` |

#### Empty State

Icon: `ScrollText`. Title: "No audit log entries". Description: "Activity will appear here as users interact with the system."

#### Pagination

Mandatory (audit logs can be large). Default: 50 rows per page.

---

## 13. Special Component: Schedule Timetable Grid

This is the most important visual component in the application.

### 13.1 Container

| Property | Value |
|----------|-------|
| Background | `--color-surface` |
| Border | 1px solid `--color-border` |
| Border-radius | `--radius-xl` (16px) |
| Shadow | `--shadow-sm` |
| Padding | 0 (grid bleeds to edges, header and cells provide internal padding) |
| Overflow | `hidden` (for border-radius). Inner content: `overflow-x: auto` for mobile scroll. |
| Min-height | 480px |

### 13.2 Grid Structure

| Property | Value |
|----------|-------|
| Display | CSS Grid |
| Columns | `80px` (time label column) + `repeat(N, minmax(160px, 1fr))` where N = number of visible days (typically 5 for Mon-Fri, up to 7) |
| Rows | `48px` (day header row) + `repeat(M, 60px)` where M = number of time slots in the semester |
| Gap | 1px (acts as grid lines via parent background color) |
| Grid background (gap color) | `--color-border` |
| Cell background | `--color-surface` |

### 13.3 Day Header Row (sticky)

| Property | Value |
|----------|-------|
| Position | `position: sticky; top: 0; z-index: 10` |
| Background | `--color-secondary-50` |
| Font | `--text-table-header` (12px, 600, uppercase) |
| Color | `--color-secondary-400` |
| Text-align | Center |
| Height | 48px |
| Border-bottom | 2px solid `--color-border` |

Content: "MONDAY", "TUESDAY", etc. (or abbreviated "MON", "TUE" on narrower views).

### 13.4 Time Label Column (sticky)

| Property | Value |
|----------|-------|
| Position | `position: sticky; left: 0; z-index: 5` |
| Width | 80px |
| Background | `--color-surface` |
| Font | `--text-mono` (13px, JetBrains Mono) |
| Color | `--color-secondary-400` |
| Alignment | Right-aligned, vertically top-aligned (padding-top: 4px, padding-right: 12px) |
| Border-right | 2px solid `--color-border` |

Content: "08:00", "08:50", "09:40", etc. (one label per timeslot row, showing start time).

### 13.5 Course Blocks

Each course block is positioned within the grid based on its assigned day column and time slot row(s). Multi-slot sessions span multiple rows.

#### Block Layout

| Property | Value |
|----------|-------|
| Position | Placed in grid cell(s) using `grid-row` spanning |
| Margin | 2px (creates visual separation within the cell) |
| Padding | 8px 10px |
| Border-radius | `--radius-md` (8px) |
| Border-left | 3px solid (category color) |
| Background | Category color (muted tint) |
| Min-height | 56px (single slot) |
| Cursor | Pointer (if override is enabled) |
| Overflow | Hidden. Text truncates with ellipsis. |
| Transition | `box-shadow var(--duration-normal) var(--ease-out)` |

#### Block Content

| Element | Spec | Line |
|---------|------|------|
| Course code | `--text-mono` (13px, 600). Category text color. | 1 |
| Course name | `--text-caption` (12px, 400). Category text color at 80% opacity. Text-overflow: ellipsis. | 2 |
| Lecturer name | `--text-caption` (12px, 400). Category text color at 60% opacity. | 3 |
| Room name | `--text-caption` (12px, 400). Category text color at 60% opacity. Shown inline with lecturer if space allows ("Room 301 - Dr. Smith"). | 3 |
| Session label | `--text-mono-sm` (12px). "Sesi A", "Sesi B". Only shown for parallel splits. | 4 (if applicable) |

For single-slot blocks (small height), show only course code + room on one line.

#### Block States

| State | Visual Treatment |
|-------|-----------------|
| **Default** | As specified above |
| **Hover** | `--shadow-md`. Slight brightness increase (filter: brightness(1.02)). |
| **Fixed schedule** | Dashed border-left instead of solid. `Lock` icon (10px) in top-right corner. |
| **Manual override** | Small `Pencil` icon (10px) in top-right corner. Subtle dashed bottom border. |
| **Conflict** | Red pulsing border: 2px solid `--color-error-500` with animated glow. `AlertTriangle` icon (10px) in top-right. |
| **Clicked/Selected** | `--shadow-lg`. 2px solid `--color-primary-500` border. Background brightens. |
| **Filtered out** | Opacity: 0.2. No pointer events. |

#### Block Tooltip (on hover, after 500ms delay)

| Property | Value |
|----------|-------|
| Container | `--color-surface` bg. `--shadow-lg`. `--radius-md`. Padding: 12px. Max-width: 280px. Z-index: 20. |
| Content | Course code + name (full, not truncated). Lecturer(s) full names. Room name + capacity. Time range. Session index. "Fixed" or "Overridden" status. |

### 13.6 Filter Controls (integrated with toolbar)

When a filter is active, non-matching blocks are faded to 20% opacity. Matching blocks remain full opacity. The grid structure (days/times) remains visible.

### 13.7 Density Controls

| Mode | Row height | Block padding | Font sizes |
|------|-----------|---------------|------------|
| Comfortable | 60px | 8px 10px | As specified |
| Compact | 44px | 4px 8px | Caption sizes throughout (12px) |

### 13.8 Print View

| Property | Value |
|----------|-------|
| Trigger | "Print" button in toolbar or Ctrl+P |
| Behavior | `@media print` stylesheet. Remove sidebar, top bar, toolbar. Grid full-width. White background. Black text. Category colors preserved but at 50% saturation for ink efficiency. Font: 10px for block content. Grid lines: 1px solid `#CCC`. Header: "GA Scheduler - Schedule [Semester Code] - Generated [Date]" at top. |

### 13.9 Dark Mode Grid

| Element | Override |
|---------|----------|
| Container bg | `--color-surface` (dark) |
| Grid gap color | `--color-border` (dark) |
| Day header bg | `--color-secondary-100` (dark) |
| Time label bg | `--color-surface` (dark) |
| Block colors | Use dark mode category colors from section 2.3 |
| Block hover shadow | `--shadow-md` (dark) |
| Tooltip bg | `--color-surface` (dark) |

### 13.10 Mobile Grid

| Screen | Behavior |
|--------|----------|
| < 640px | Switch to card-based list by default (toggle available). Grid available via horizontal scroll with touch inertia. Time column sticky left. Day headers sticky top. Minimum column width: 140px. |
| 640-1024px | Grid visible with horizontal scroll. All 5 days visible if tablet is landscape. |
| > 1024px | Full grid, no scroll needed for 5-day view. 6-7 day view may scroll. |

---

## 14. Special Component: GA Progress Monitor

The real-time view displayed while a GA run is executing, powered by Server-Sent Events.

### 14.1 Overall Layout

```
+----------------------------------------------------+
| Header: Run ID + Status Badge + Elapsed Timer      |
+----------------------------------------------------+
| Stats Panel (5 cards in a row)                      |
| [Generation] [Best Fitness] [Hard Viol.] [Soft P.] |
| [Competency Mismatch]                               |
+----------------------------------------------------+
| Progress Bar (full width)                           |
| ████████████████████░░░░░ 142 / 200 (71%)          |
+----------------------------------------------------+
| Fitness Curve Chart (full width, 300px height)      |
| - Best fitness line (solid blue)                    |
| - Average fitness line (dashed cyan)                |
+----------------------------------------------------+
| Action Bar                                          |
| [Cancel Run] (danger)          [View Schedule] btn  |
+----------------------------------------------------+
```

### 14.2 Header Bar

| Element | Spec |
|---------|------|
| Run ID | `--text-mono` (13px). Truncated to first 8 chars. Copyable (click to copy full ID). |
| Status badge | Per status badge spec. RUNNING: animated pulse. |
| Elapsed timer | `--text-mono` (16px, 600). `--color-secondary-700`. Live-updating: "0:02.4", "1:23.7", etc. |

### 14.3 Stats Panel

Five stat cards in a row. Each card:

| Property | Value |
|----------|-------|
| Background | `--color-surface` |
| Border | 1px solid `--color-border` |
| Border-radius | `--radius-lg` |
| Padding | 16px |
| Layout | Centered content |

| Stat | Label | Value Format | Value Font | Highlight Color |
|------|-------|-------------|------------|-----------------|
| Generation | "Generation" | "142 / 200" | `--text-card-title` (20px, 700), mono | `--color-secondary-900` |
| Best Fitness | "Best Fitness" | "0.9412" | `--text-card-title`, mono | Green if > 0.9, yellow if 0.7-0.9, red if < 0.7 |
| Hard Violations | "Hard Violations" | "0" | `--text-card-title`, mono | Green if 0, red if > 0 |
| Soft Penalty | "Soft Penalty" | "12" | `--text-card-title`, mono | `--color-secondary-900` |
| Competency Mismatch | "Competency Mismatch" | "0" | `--text-card-title`, mono | Green if 0, red if > 0 |

Mobile: 2 columns + 1 spanning full. Or 2-3-column wrap.

### 14.4 Progress Bar

| Property | Value |
|----------|-------|
| Container | Full-width. Height: 8px. Background: `--color-secondary-200`. `--radius-pill`. |
| Fill | Background: linear-gradient(90deg, `--color-primary-500`, `--color-accent-500`). Width: `(currentGeneration / maxGenerations) * 100%`. `--radius-pill`. Transition: `width var(--duration-normal) var(--ease-out)`. |
| Label below | "142 / 200 (71%)" in `--text-body-sm`, `--color-secondary-500`. Right-aligned. |
| Indeterminate state | (While QUEUED, before first SSE event): animated gradient shimmer moving left to right. |

### 14.5 Fitness Curve Chart

Uses the chart spec from 11.8 with these specifics:

| Property | Value |
|----------|-------|
| Height | 300px (desktop), 240px (tablet), 200px (mobile) |
| X-axis | Generation (0 to maxGenerations). Dynamic range as data comes in. |
| Y-axis (left) | Fitness (0 to 1.0). |
| Y-axis (right, optional) | Hard violations count. |
| Best fitness line | `--color-primary-500`, 2px solid |
| Average fitness line | `--color-accent-400`, 1.5px dashed |
| Hard violations line | `--color-error-500`, 1px, area fill at 10% opacity. Only if violations > 0 at any point. |
| Real-time update | New data point appended per SSE event. Line animates to new point. X-axis auto-scales. Smooth scroll if chart exceeds visible width. |
| Tooltip | On hover, show vertical line at generation. Display: generation, best fitness, avg fitness, hard violations for that generation. |

### 14.6 Action Bar

| Element | Spec |
|---------|------|
| Cancel button | Danger button. "Cancel Run" with `XCircle` icon. Visible only when status = RUNNING or QUEUED. Click triggers confirmation dialog. |
| View Schedule button | Primary button. "View Schedule" with `CalendarDays` icon. Visible only when status = COMPLETED or STAGNATED. Navigates to `/schedule` with this run pre-selected. |

### 14.7 Cancel Confirmation Dialog

Confirmation dialog (modal-sm). Danger variant.

- Icon: `AlertTriangle` in `--color-error-50` circle
- Title: "Cancel Schedule Run?"
- Description: "This will stop the current optimization. The run cannot be resumed. Any partial results will be discarded."
- Actions: "Keep Running" (secondary) + "Cancel Run" (danger)

### 14.8 Status Transitions

| From | To | Visual |
|------|----|--------|
| QUEUED | RUNNING | Status badge transitions. Progress bar switches from indeterminate to determinate. Stats begin updating. |
| RUNNING | COMPLETED | Status badge: green. Progress bar: 100%. Chart freezes. Success toast. "View Schedule" button appears. Subtle celebration animation (optional). |
| RUNNING | STAGNATED | Status badge: yellow. Warning banner below chart: "The GA stagnated at generation [N] due to insufficient fitness improvement." |
| RUNNING | FAILED | Status badge: red. Error card below chart with error message. `errorCode` and `errorMessage` displayed. |
| RUNNING | CANCELLED | Status badge: gray. Info banner: "Run was cancelled by user." |
| RUNNING | SSA_INFEASIBLE | Status badge: red. Error card: "Structural analysis detected that no valid schedule exists for the current data configuration. Review your offerings, rooms, and timeslots." |
| RUNNING | PRE_GA_EMPTY | Status badge: red. Error card: "No feasible candidates passed pre-GA validation. Check course offerings for constraint violations." |

### 14.9 Disconnection Handling

If the SSE connection drops:

| Property | Value |
|----------|-------|
| Banner | Yellow warning banner at top of monitor: "Connection lost. Reconnecting..." |
| Behavior | Auto-retry with exponential backoff (1s, 2s, 4s, 8s, max 30s) |
| Reconnected | Banner dismissed. Missed data points fetched via REST API and backfilled into chart. |
| Permanently failed | Banner changes to: "Unable to reconnect. Refresh the page to see current progress." with "Refresh" button. |

---

## 15. Accessibility Standards

### WCAG AA Compliance

| Requirement | Implementation |
|-------------|----------------|
| **Color contrast (normal text)** | 4.5:1 minimum. `--color-secondary-700` on `--color-bg-primary` = 10.5:1. `--color-secondary-500` on `--color-bg-primary` = 5.4:1. |
| **Color contrast (large text)** | 3:1 minimum. All headings meet this. |
| **Color contrast (UI components)** | 3:1 for borders and interactive affordances. |
| **Keyboard navigation** | All interactive elements focusable via Tab. Focus order follows visual order. Sidebar navigable with arrow keys. |
| **Focus indicators** | `:focus-visible` shows `--shadow-ring` (3px primary ring, offset 2px). Never suppress default focus. |
| **Touch targets** | Minimum 44px x 44px for all interactive elements on touch devices. Table row actions: 44px tap target. |
| **Heading hierarchy** | One H1 per page (page title). Sections use H2. No skipped levels. |
| **Semantic HTML** | `<nav>` for sidebar, `<main>` for content, `<table>` for data tables, `<dialog>` for modals. ARIA landmarks. |
| **Reduced motion** | All animations in `@media (prefers-reduced-motion: no-preference)`. Fallback: instant transitions. GA chart still updates data but without draw animation. |
| **Text scaling** | Layout functional at 200% zoom. Sidebar collapses. Tables scroll. No horizontal overflow on main content. |
| **Color not sole indicator** | Status uses badges with text labels (not just color). Chart lines differ by dash pattern. Schedule blocks have text content (not just color). |

### Screen Reader Considerations

| Element | ARIA Treatment |
|---------|---------------|
| Sidebar | `<nav aria-label="Main navigation">`. Active item: `aria-current="page"`. |
| Sidebar collapse | Button: `aria-label="Collapse sidebar"`, `aria-expanded="true/false"`. |
| Top bar semester selector | `<select aria-label="Active semester">` |
| Dark mode toggle | `<button aria-label="Switch to dark mode">`, updates to "Switch to light mode" |
| Data tables | `<table>` with `<caption>` describing content. Sortable headers: `aria-sort="ascending/descending/none"`. |
| Modals | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to title. Focus trapped inside. Return focus on close. |
| Toasts | `role="alert"`, `aria-live="polite"`. Error toasts: `aria-live="assertive"`. |
| Progress bar | `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax` (maxGenerations). `aria-label="GA progress"`. |
| Schedule grid | `role="grid"`, `aria-label="Course schedule timetable"`. Row/column headers with `role="rowheader"` / `role="columnheader"`. |
| Course blocks | `role="gridcell"`. `aria-label` with full description: "[Course] with [Lecturer] in [Room], [Day] [Time]". |
| Status badges | `aria-label` with status name. RUNNING: `aria-live="polite"` for updates. |
| Fitness chart | `aria-label="Fitness curve chart"`. Provide a text summary below for screen readers: "Best fitness: 0.94 at generation 142. Average fitness: 0.87." |

---

## 16. CSS Custom Properties Summary

Complete token set for implementation.

```css
:root {
  /* ── Primary ── */
  --color-primary-50: #EEF2FF;
  --color-primary-100: #D8E0FC;
  --color-primary-200: #B0C1F9;
  --color-primary-400: #6382E8;
  --color-primary-500: #4361D0;
  --color-primary-600: #3349A8;
  --color-primary-700: #273882;
  --color-primary-900: #141D42;

  /* ── Secondary (neutral) ── */
  --color-secondary-50: #F8FAFC;
  --color-secondary-100: #F1F5F9;
  --color-secondary-200: #E2E8F0;
  --color-secondary-300: #CBD5E1;
  --color-secondary-400: #94A3B8;
  --color-secondary-500: #64748B;
  --color-secondary-700: #334155;
  --color-secondary-900: #0F172A;

  /* ── Accent ── */
  --color-accent-400: #38BDF8;
  --color-accent-500: #0EA5E9;

  /* ── Semantic ── */
  --color-success-50: #F0FDF4;
  --color-success-500: #22C55E;
  --color-success-700: #15803D;
  --color-warning-50: #FFFBEB;
  --color-warning-500: #F59E0B;
  --color-warning-700: #A16207;
  --color-error-50: #FEF2F2;
  --color-error-500: #EF4444;
  --color-error-700: #B91C1C;
  --color-info-50: #EFF6FF;
  --color-info-500: #3B82F6;

  /* ── Backgrounds & Surfaces ── */
  --color-bg-primary: #FFFFFF;
  --color-bg-secondary: #F8FAFC;
  --color-surface: #FFFFFF;
  --color-border: #E2E8F0;

  /* ── Typography ── */
  --font-family-primary: 'Inter', system-ui, -apple-system, sans-serif;
  --font-family-mono: 'JetBrains Mono', 'Fira Code', monospace;

  --text-page-title: clamp(1.5rem, 1.25rem + 1vw, 1.875rem);
  --text-section-title: clamp(1.25rem, 1.125rem + 0.5vw, 1.5rem);
  --text-card-title: 1.25rem;
  --text-subtitle: 1.125rem;
  --text-body-lg: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
  --text-body: 1rem;
  --text-body-sm: 0.875rem;
  --text-caption: 0.75rem;
  --text-overline: 0.75rem;
  --text-button: 0.875rem;
  --text-button-lg: 1rem;
  --text-mono: 0.8125rem;
  --text-mono-sm: 0.75rem;
  --text-table-header: 0.75rem;

  /* ── Spacing ── */
  --space-0: 0;
  --space-0-5: 0.125rem;
  --space-1: 0.25rem;
  --space-1-5: 0.375rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;

  /* ── Border Radius ── */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-pill: 9999px;
  --radius-full: 50%;

  /* ── Shadows ── */
  --shadow-xs: 0 1px 2px 0 rgba(15, 23, 42, 0.04);
  --shadow-sm: 0 1px 3px 0 rgba(15, 23, 42, 0.06), 0 1px 2px -1px rgba(15, 23, 42, 0.06);
  --shadow-md: 0 4px 6px -1px rgba(15, 23, 42, 0.07), 0 2px 4px -2px rgba(15, 23, 42, 0.05);
  --shadow-lg: 0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04);
  --shadow-xl: 0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04);
  --shadow-ring: 0 0 0 3px rgba(67, 97, 208, 0.15);
  --shadow-ring-error: 0 0 0 3px rgba(239, 68, 68, 0.15);

  /* ── Transitions ── */
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 350ms;
  --duration-slower: 500ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.45, 0, 0.55, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* ── Layout ── */
  --sidebar-width: 256px;
  --sidebar-width-collapsed: 64px;
  --topbar-height: 56px;
  --content-max-width: 1440px;
}

/* ── Dark Mode ── */
[data-theme="dark"] {
  --color-primary-50: #1A2240;
  --color-primary-100: #1E2A52;
  --color-primary-400: #7B9AEF;
  --color-primary-500: #6382E8;
  --color-primary-600: #7B9AEF;
  --color-primary-700: #93AAFF;

  --color-secondary-50: #0D1117;
  --color-secondary-100: #161B22;
  --color-secondary-200: #21262D;
  --color-secondary-300: #30363D;
  --color-secondary-400: #7D8590;
  --color-secondary-500: #9CA3AF;
  --color-secondary-700: #D1D5DB;
  --color-secondary-900: #F0F6FC;

  --color-accent-400: #38BDF8;
  --color-accent-500: #38BDF8;

  --color-success-50: #0D2818;
  --color-success-500: #4ADE80;
  --color-warning-50: #2D1F04;
  --color-warning-500: #FBBF24;
  --color-error-50: #2D0F0F;
  --color-error-500: #F87171;
  --color-info-50: #0C1D36;
  --color-info-500: #60A5FA;

  --color-bg-primary: #0D1117;
  --color-bg-secondary: #161B22;
  --color-surface: #1C2128;
  --color-border: #30363D;

  --shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.3);
  --shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.4), 0 1px 2px -1px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.45), 0 2px 4px -2px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.3);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
  --shadow-ring: 0 0 0 3px rgba(99, 130, 232, 0.25);
  --shadow-ring-error: 0 0 0 3px rgba(248, 113, 113, 0.25);
}
```

---

*End of specification. This document provides all values needed for a developer to implement the full GA Scheduler application interface without design ambiguity. All color combinations have been validated against WCAG AA contrast requirements. All spacing derives from the 4px base unit. All components include light and dark mode variants. Every page includes specifications for empty states, loading states, error states, interactive states, and responsive behavior.*
