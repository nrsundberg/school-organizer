#!/usr/bin/env python3
"""
HeroUI v2 → v3 Migration Script

Automatically applies safe transforms (renames, removals, prop fixes) and
produces a report of items requiring manual review.

Usage:
    python scripts/heroui_migrate.py app/              # apply in-place
    python scripts/heroui_migrate.py app/ --dry-run    # preview only
    python scripts/heroui_migrate.py app/ --report     # always write report file

Requirements: Python 3.8+, stdlib only — no external dependencies.
"""

import argparse
import os
import re
import sys
from dataclasses import dataclass, field


# ─── V2 → V3 rename map ───────────────────────────────────────────────────────

RENAME_MAP = {
    # Select / ListBox
    "SelectItem":        "ListBoxItem",
    "AutocompleteItem":  "ListBoxItem",
    "Listbox":           "ListBox",
    "ListboxItem":       "ListBoxItem",
    "ListboxSection":    "ListBoxSection",
    # Layout / misc
    "Divider":           "Separator",
    "CircularProgress":  "ProgressCircle",
    "Progress":          "ProgressBar",
    "DateInput":         "DateField",
    "Textarea":          "TextArea",
    "BreadcrumbItem":    "BreadcrumbsItem",
    "ModalContent":      "ModalDialog",
}

# Items that, when renamed to ListBoxItem, need key→id prop fix
COLLECTION_ITEM_SOURCES = {"SelectItem", "AutocompleteItem", "ListboxItem"}

# ─── Items to strip from @heroui/react imports ────────────────────────────────

# Removed entirely (no replacement)
REMOVED_FROM_HEROUI = {
    "HeroUIProvider",
    "getKeyValue",
    "SharedSelection",
    "SortDescriptor",
    # Removed components
    "Navbar", "NavbarBrand", "NavbarContent", "NavbarItem",
    "NavbarMenu", "NavbarMenuToggle",
    "Image",
    "User",
    "AvatarGroup", "AvatarIcon",
    "Snippet",
    "Spacer",
    "Code",
    "SelectSection",
}

# ─── Flag messages for removed imports ───────────────────────────────────────

REMOVED_IMPORT_NOTES = {
    "getKeyValue":
        "Replace call sites: getKeyValue(item, key) → (item as any)[key]",
    "SharedSelection":
        "Replace type with: import type { Selection } from 'react-aria-components'",
    "SortDescriptor":
        "Now from react-aria-components: import type { SortDescriptor } from 'react-aria-components'",
    "HeroUIProvider":
        "Remove <HeroUIProvider> wrapper (done automatically) — check for leftover props like locale/theme",
}

REMOVED_COMPONENT_NOTES = {
    "Navbar":         "Build custom nav with Tailwind (all Navbar* components removed in v3)",
    "NavbarBrand":    "Build custom nav with Tailwind (all Navbar* components removed in v3)",
    "NavbarContent":  "Build custom nav with Tailwind (all Navbar* components removed in v3)",
    "NavbarItem":     "Build custom nav with Tailwind (all Navbar* components removed in v3)",
    "NavbarMenu":     "Build custom nav with Tailwind (all Navbar* components removed in v3)",
    "NavbarMenuToggle": "Build custom nav with Tailwind (all Navbar* components removed in v3)",
    "Image":          "Use HTML <img> or framework Image component (Image removed in v3)",
    "User":           "Build custom component with Avatar + text (User removed in v3)",
    "AvatarGroup":    "Use flex layout with individual Avatar components (AvatarGroup removed in v3)",
    "AvatarIcon":     "Use AvatarFallback with an icon (AvatarIcon removed in v3)",
    "Snippet":        "Use <pre>/<code> with Tailwind + copy button (Snippet removed in v3)",
    "Spacer":         "Use Tailwind margin/padding utilities (Spacer removed in v3)",
    "Code":           "Use HTML <code> with Tailwind (Code removed in v3)",
    "SelectSection":  "Use ListBoxSection inside Select (SelectSection removed in v3)",
}

# ─── @heroui/shared-icons → lucide-react ─────────────────────────────────────

ICON_MAP = {
    "SendFilledIcon":       "Send",
    "SendIcon":             "Send",
    "SearchIcon":           "Search",
    "ChevronDownIcon":      "ChevronDown",
    "ChevronUpIcon":        "ChevronUp",
    "ChevronLeftIcon":      "ChevronLeft",
    "ChevronRightIcon":     "ChevronRight",
    "CloseIcon":            "X",
    "EyeIcon":              "Eye",
    "EyeSlashIcon":         "EyeOff",
    "EditIcon":             "Pencil",
    "DeleteIcon":           "Trash2",
    "AddIcon":              "Plus",
    "MinusIcon":            "Minus",
    "CheckIcon":            "Check",
    "InfoIcon":             "Info",
    "WarningIcon":          "AlertTriangle",
    "DangerIcon":           "AlertCircle",
    "SuccessIcon":          "CheckCircle2",
    "ArrowLeftIcon":        "ArrowLeft",
    "ArrowRightIcon":       "ArrowRight",
    "ArrowUpIcon":          "ArrowUp",
    "ArrowDownIcon":        "ArrowDown",
    "MenuIcon":             "Menu",
    "StarIcon":             "Star",
    "HeartIcon":            "Heart",
    "SettingsIcon":         "Settings",
    "HomeIcon":             "Home",
    "UserIcon":             "User",
    "LockIcon":             "Lock",
    "UnlockIcon":           "Unlock",
    "CopyIcon":             "Copy",
    "DownloadIcon":         "Download",
    "UploadIcon":           "Upload",
    "RefreshIcon":          "RefreshCw",
    "ShareIcon":            "Share2",
    "NotificationIcon":     "Bell",
    "FilterIcon":           "Filter",
    "SortIcon":             "ArrowUpDown",
    "ExternalLinkIcon":     "ExternalLink",
    "LinkIcon":             "Link",
    "ImageIcon":            "Image",
    "FileIcon":             "File",
    "FolderIcon":           "Folder",
    "CalendarIcon":         "Calendar",
    "ClockIcon":            "Clock",
    "EmailIcon":            "Mail",
    "MailIcon":             "Mail",
    "PhoneIcon":            "Phone",
    "LocationIcon":         "MapPin",
    "MapPinIcon":           "MapPin",
    "ThumbsUpIcon":         "ThumbsUp",
    "ThumbsDownIcon":       "ThumbsDown",
    "MoonIcon":             "Moon",
    "SunIcon":              "Sun",
    "EllipsisIcon":         "Ellipsis",
    "MoreVerticalIcon":     "MoreVertical",
    "MoreHorizontalIcon":   "MoreHorizontal",
    "GithubIcon":           "Github",
    "TwitterIcon":          "Twitter",
    "LoaderIcon":           "Loader2",
}

# ─── V3 removed props per component ──────────────────────────────────────────
# Maps component name → { prop_name: flag_note_or_None }
# None = silently remove; string = remove and add a flag for manual follow-up.
# Keys must match the POST-RENAME component name (e.g. "TextArea", not "Textarea").

REMOVED_COMPONENT_PROPS = {
    "Table": {
        "removeWrapper": None,   # layout-only; safe to drop silently
        "isCompact": None,       # styling-only; use className if needed
        "isHeaderSticky": None,  # use className="sticky top-0" if needed
    },
    "Input": {
        "labelPlacement": None,  # no v3 equivalent; label is a separate element
        "errorMessage": (
            "Input `errorMessage` prop removed in v3 — "
            "render error text in a sibling element, e.g. <p className=\"text-red-400 text-sm\">"
        ),
        "isInvalid": (
            "Input `isInvalid` prop removed in v3 — "
            "use aria-invalid or conditional className for styling"
        ),
        "description": (
            "Input `description` prop removed in v3 — "
            "render description in a sibling <p> element or use placeholder"
        ),
    },
    "TextArea": {
        "labelPlacement": None,
        "errorMessage": (
            "TextArea `errorMessage` prop removed in v3 — "
            "render error text in a sibling element"
        ),
        "isInvalid": (
            "TextArea `isInvalid` prop removed in v3 — "
            "use aria-invalid or conditional className for styling"
        ),
        "description": (
            "TextArea `description` prop removed in v3 — "
            "render description in a sibling <p> element or use placeholder"
        ),
    },
    "Button": {
        "startContent": (
            "Button `startContent` prop removed in v3 — "
            "place the icon element as the first child inside the Button"
        ),
        "endContent": (
            "Button `endContent` prop removed in v3 — "
            "place the icon element as the last child inside the Button"
        ),
    },
}

# ─── V3 prop transforms (auto-fixed, not just removed) ──────────────────────
# Maps component → { old_prop: transform_info }
# transform_info is a dict with:
#   "rename": new prop name (value preserved)
#   "value_map": { old_value: new_value } for renaming prop values
#   "flag": optional flag message for manual review

BUTTON_COLOR_TO_VARIANT = {
    "primary":   "primary",
    "secondary": "secondary",
    "danger":    "danger",
    "warning":   "secondary",
    "default":   "ghost",
    "success":   "primary",
}

BUTTON_VARIANT_MAP = {
    "flat":    "ghost",
    "light":   "ghost",
    "faded":   "outline",
    "bordered": "outline",
    "solid":   "primary",
    "shadow":  "primary",
}

PROP_TRANSFORMS = {
    "Button": {
        "color": {
            "rename": "variant",
            "value_map": BUTTON_COLOR_TO_VARIANT,
            "flag": None,
        },
        "isLoading": {
            "rename": "isPending",
            "flag": None,
        },
        "variant": {
            "rename": "variant",
            "value_map": BUTTON_VARIANT_MAP,
            "flag": None,
        },
    },
    "Input": {
        "label": {
            "action": "wrap_label",
            "flag": (
                "Input `label` prop removed in v3 — "
                "converted to explicit <label> element; verify visually"
            ),
        },
        "onValueChange": {
            "action": "convert_onValueChange",
            "flag": None,
        },
        "isRequired": {
            "rename": "required",
            "flag": None,
        },
        "isDisabled": {
            "rename": "disabled",
            "flag": None,
        },
    },
    "TextArea": {
        "label": {
            "action": "wrap_label",
            "flag": (
                "TextArea `label` prop removed in v3 — "
                "converted to explicit <label> element; verify visually"
            ),
        },
        "onValueChange": {
            "action": "convert_onValueChange",
            "flag": None,
        },
        "isRequired": {
            "rename": "required",
            "flag": None,
        },
        "isDisabled": {
            "rename": "disabled",
            "flag": None,
        },
    },
}


# ─── Components that exist in v3 but have API/structural changes ──────────────

STRUCTURAL_CHANGE_NOTES = {
    "Accordion":    "Accordion exists in v3 with compound pattern — verify AccordionItem still works",
    "Modal":        "ModalContent → ModalDialog (auto-renamed); modal structure changed — verify visually",
    "Tabs":         "Tabs exist in v3 but internal structure changed — verify visually",
    "Tooltip":      "Tooltip exists in v3 with compound pattern — verify visually",
    "Select": (
        "Select v3 uses compound components (SelectRoot/SelectTrigger/SelectPopover/ListBox). "
        "Direct <ListBoxItem> children crash in SSR — see ACTION REQUIRED flag if present."
    ),
    "Autocomplete": (
        "Autocomplete v3 uses compound components (AutocompleteRoot/AutocompleteTrigger/AutocompletePopover/ListBox). "
        "Direct <ListBoxItem> children may crash in SSR — see ACTION REQUIRED flag if present."
    ),
    "Table":        "Table exists in v3; some sub-component names may differ — verify visually",
    "Popover":      "Popover exists in v3; PopoverContent still present — verify visually",
}


# ─── Result tracking ──────────────────────────────────────────────────────────

@dataclass
class FileResult:
    path: str
    changed: bool = False
    changes: list = field(default_factory=list)
    flags: list = field(default_factory=list)


# ─── Import-block transforms ──────────────────────────────────────────────────

# Pattern captures: group(1) = items string, group(2) = package name
HEROUI_IMPORT_RE = re.compile(
    r'import\s*\{([^}]+)\}\s*from\s*["\'](@heroui/react|@heroui/shared-icons)["\']\s*;?',
    re.DOTALL,
)


def _parse_import_items(items_str: str) -> list:
    """Split an import items string by comma, return stripped non-empty parts."""
    parts = []
    for part in items_str.split(","):
        stripped = part.strip()
        if stripped:
            parts.append(stripped)
    return parts


def _item_base_name(item: str) -> str:
    """Extract the component name from 'type Foo' or 'Foo as Bar' or 'Foo'."""
    item = re.sub(r'^type\s+', '', item.strip())
    return item.split(" as ")[0].strip()


def rewrite_heroui_react_import(items_str: str, result: FileResult):
    """
    Rewrite items in an @heroui/react import block.
    Returns the new items string, or None if the import should be removed entirely.
    """
    items = _parse_import_items(items_str)
    new_items = []
    added = set()         # deduplicate renames
    removed = []
    renamed = {}          # old → new (for logging)

    for item in items:
        base = _item_base_name(item)
        is_type = item.strip().startswith("type ")

        if base in REMOVED_FROM_HEROUI:
            removed.append(base)
            if base in REMOVED_IMPORT_NOTES:
                result.flags.append(f"Removed import '{base}': {REMOVED_IMPORT_NOTES[base]}")
            elif base in REMOVED_COMPONENT_NOTES:
                result.flags.append(f"Removed import '{base}': {REMOVED_COMPONENT_NOTES[base]}")
            continue

        if base in RENAME_MAP:
            new_name = RENAME_MAP[base]
            renamed[base] = new_name
            if new_name not in added:
                new_items.append(new_name)
                added.add(new_name)
            # Don't add the old name
        else:
            if base not in added:
                new_items.append(item)  # preserve original formatting (type prefix etc.)
                added.add(base)

    if removed:
        result.changes.append(
            f"Removed from @heroui/react: {', '.join(sorted(removed))}"
        )
        result.changed = True

    if renamed:
        renames_str = ", ".join(f"{k}→{v}" for k, v in sorted(renamed.items()))
        result.changes.append(f"Renamed in @heroui/react import: {renames_str}")
        result.changed = True

    return new_items if new_items else None


def rewrite_shared_icons_import(items_str: str, result: FileResult) -> list:
    """
    Handle @heroui/shared-icons import.
    Returns a list of lucide-react icon names to add.
    """
    items = _parse_import_items(items_str)
    icon_names = [_item_base_name(item) for item in items]

    lucide_icons = []
    unmapped = []

    for icon in icon_names:
        if icon in ICON_MAP:
            lucide = ICON_MAP[icon]
            if lucide not in lucide_icons:
                lucide_icons.append(lucide)
        else:
            unmapped.append(icon)

    result.changes.append(
        f"Removed @heroui/shared-icons import: {', '.join(icon_names)}"
    )
    result.changed = True

    if lucide_icons:
        result.changes.append(
            f"Adding to lucide-react: {', '.join(lucide_icons)}"
        )

    if unmapped:
        result.flags.append(
            f"Unmapped @heroui/shared-icons icons (add manually): {', '.join(unmapped)}"
        )

    return lucide_icons


def _rebuild_import(items: list, package: str, multiline: bool) -> str:
    """Rebuild an import statement from items list."""
    if multiline:
        body = ",\n".join(f"  {item}" for item in items)
        return f'import {{\n{body}\n}} from "{package}";'
    else:
        return f'import {{ {", ".join(items)} }} from "{package}";'


def merge_lucide_import(content: str, icons_to_add: list) -> str:
    """
    Merge icons_to_add into an existing lucide-react import, or leave a
    standalone one (already inserted by the import replacer).
    """
    if not icons_to_add:
        return content

    lucide_re = re.compile(
        r'import\s*\{([^}]+)\}\s*from\s*["\']lucide-react["\']\s*;?',
        re.DOTALL,
    )
    matches = list(lucide_re.finditer(content))

    if len(matches) > 1:
        # Merge all lucide imports into the first one
        all_icons: list = []
        for m in matches:
            all_icons.extend(
                _item_base_name(i) for i in _parse_import_items(m.group(1))
            )
        unique = sorted(set(all_icons))
        merged = f'import {{ {", ".join(unique)} }} from "lucide-react";'
        # Replace first, remove rest
        first = True
        def replacer(m):
            nonlocal first
            if first:
                first = False
                return merged
            return ""
        content = lucide_re.sub(replacer, content)
        content = re.sub(r'\n{3,}', '\n\n', content)

    return content


def transform_imports(content: str, result: FileResult) -> tuple:
    """
    Rewrite all @heroui/react and @heroui/shared-icons imports.
    Returns (new_content, lucide_icons_added).
    """
    lucide_icons_from_shared = []

    def replacer(match):
        items_str = match.group(1)
        package = match.group(2)
        full_match = match.group(0)
        is_multiline = "\n" in full_match

        if package == "@heroui/react":
            new_items = rewrite_heroui_react_import(items_str, result)
            if new_items is None:
                return ""  # remove entire import
            return _rebuild_import(new_items, "@heroui/react", is_multiline)

        elif package == "@heroui/shared-icons":
            icons = rewrite_shared_icons_import(items_str, result)
            lucide_icons_from_shared.extend(icons)
            if icons:
                return f'import {{ {", ".join(icons)} }} from "lucide-react";'
            return ""  # remove entirely if no mapped icons

        return full_match  # shouldn't happen

    new_content = HEROUI_IMPORT_RE.sub(replacer, content)
    new_content = re.sub(r'\n{3,}', '\n\n', new_content)
    return new_content, lucide_icons_from_shared


# ─── JSX transforms ───────────────────────────────────────────────────────────

def rename_jsx_elements(content: str, result: FileResult) -> str:
    """Apply RENAME_MAP to JSX opening and closing tags."""
    renamed_found = {}

    for old, new in RENAME_MAP.items():
        if old == new:
            continue

        opening_re = re.compile(r'<(' + re.escape(old) + r')([\s/>])')
        closing_re = re.compile(r'</(' + re.escape(old) + r')>')

        n_before = len(opening_re.findall(content)) + len(closing_re.findall(content))
        if n_before == 0:
            continue

        content = opening_re.sub(r'<' + new + r'\2', content)
        content = closing_re.sub(r'</' + new + r'>', content)
        renamed_found[old] = new

    if renamed_found:
        renames_str = ", ".join(f"<{k}>→<{v}>" for k, v in sorted(renamed_found.items()))
        result.changes.append(f"Renamed JSX elements: {renames_str}")
        result.changed = True

    return content


def add_id_prop_to_list_box_items(content: str, result: FileResult) -> str:
    """
    Add id={...} to <ListBoxItem key={...}> elements.
    React-aria uses id for selection; key is still needed for reconciliation.

    Handles:
        <ListBoxItem key={expr}   →  <ListBoxItem key={expr} id={expr}
        <ListBoxItem key="str"    →  <ListBoxItem key="str" id="str"
    """
    # Expression keys: key={...}
    expr_re = re.compile(r'(<ListBoxItem\b[^>]*?)\bkey=\{([^}]+)\}(?!\s+id=)')
    str_re  = re.compile(r'(<ListBoxItem\b[^>]*?)\bkey="([^"]+)"(?!\s+id=)')

    def fix_expr(m):
        before, val = m.group(1), m.group(2)
        if 'id=' in before:
            return m.group(0)
        return f'{before}key={{{val}}} id={{{val}}}'

    def fix_str(m):
        before, val = m.group(1), m.group(2)
        if 'id=' in before:
            return m.group(0)
        return f'{before}key="{val}" id="{val}"'

    new_content = expr_re.sub(fix_expr, content)
    new_content = str_re.sub(fix_str, new_content)

    if new_content != content:
        result.changes.append(
            "Added id prop to ListBoxItem elements (react-aria selection key)"
        )
        result.changed = True

    return new_content


def remove_heroui_provider(content: str, result: FileResult) -> str:
    """Remove <HeroUIProvider ...> and </HeroUIProvider> wrapper tags."""
    # Opening tag (may span multiple lines, may have props)
    open_re = re.compile(r'[ \t]*<HeroUIProvider(?:[^>]|(?<=<HeroUIProvider)[^/])*?>\n?', re.DOTALL)
    close_re = re.compile(r'[ \t]*</HeroUIProvider>\n?')

    n_open = len(open_re.findall(content))
    n_close = len(close_re.findall(content))

    if n_open > 0 or n_close > 0:
        content = open_re.sub('', content)
        content = close_re.sub('', content)
        result.changes.append("Removed <HeroUIProvider> wrapper")
        result.changed = True

    return content


# ─── Prop removal ────────────────────────────────────────────────────────────

# Matches a single prop inside a JSX opening tag's attribute string.
# Handles: prop="str"  prop='str'  prop={expr}  prop  (boolean / bare)
# NOTE: {expr} only matches flat braces (no nested {}).  Complex expressions
# like {a ? {b:1} : {c:2}} are rare in JSX prop positions; flag manually if
# the pattern fails.
_PROP_VALUE_RE = r'(?:=(?:"[^"]*"|\'[^\']*\'|\{[^{}]*\}))?'


def strip_removed_props(content: str, result: FileResult) -> str:
    """
    Remove props listed in REMOVED_COMPONENT_PROPS from their target components.
    Runs after JSX renames so component names are already in their v3 form.
    """
    for component, props in REMOVED_COMPONENT_PROPS.items():
        # Match the full opening tag (may span lines): <Component ... >
        # Capture:  group(1)=tag-start  group(2)=attributes  group(3)=tag-end
        tag_re = re.compile(
            r'(<' + re.escape(component) + r'\b)([^>]*)(>)',
            re.DOTALL,
        )

        for prop, note in props.items():
            # Strip this prop anywhere it appears in the tag's attributes.
            prop_re = re.compile(
                r'\s+' + re.escape(prop) + _PROP_VALUE_RE + r'(?=[\s/>])',
                re.DOTALL,
            )

            removed_count = [0]

            def _remove(m, _prop_re=prop_re, _count=removed_count):
                tag_start, attrs, tag_end = m.group(1), m.group(2), m.group(3)
                new_attrs, n = _prop_re.subn('', attrs)
                _count[0] += n
                return tag_start + new_attrs + tag_end

            content = tag_re.sub(_remove, content)

            if removed_count[0]:
                result.changes.append(
                    f"Removed `{prop}` prop from <{component}> "
                    f"({removed_count[0]} occurrence{'s' if removed_count[0] > 1 else ''})"
                )
                result.changed = True
                if note:
                    result.flags.append(
                        f"PROP REMOVED — <{component} {prop}=...>: {note}"
                    )

    return content


# ─── Prop transforms ─────────────────────────────────────────────────────────

def _extract_prop_value(attrs: str, prop_name: str):
    """
    Extract a prop's value from an attribute string.
    Returns (value_str, quote_char, is_expr, full_match) or None if not found.
    value_str is the inner value (without quotes/braces).
    """
    # String values: prop="value" or prop='value'
    m = re.search(
        r'\s+' + re.escape(prop_name) + r'="([^"]*)"',
        attrs,
    )
    if m:
        return m.group(1), '"', False, m.group(0)

    m = re.search(
        r"\s+" + re.escape(prop_name) + r"='([^']*)'",
        attrs,
    )
    if m:
        return m.group(1), "'", False, m.group(0)

    # Expression values: prop={expr}
    m = re.search(
        r'\s+' + re.escape(prop_name) + r'=\{([^{}]*)\}',
        attrs,
    )
    if m:
        return m.group(1), None, True, m.group(0)

    # Boolean prop (no value): prop
    m = re.search(
        r'\s+' + re.escape(prop_name) + r'(?=[\s/>])',
        attrs,
    )
    if m:
        return None, None, False, m.group(0)

    return None


def apply_prop_transforms(content: str, result: FileResult) -> str:
    """
    Apply PROP_TRANSFORMS: rename props, map values, convert onValueChange,
    and handle label→wrapping-label transforms.
    """
    for component, transforms in PROP_TRANSFORMS.items():
        tag_re = re.compile(
            r'(<' + re.escape(component) + r'\b)([^>]*?)(\s*/?>)',
            re.DOTALL,
        )

        for prop_name, transform in transforms.items():
            action = transform.get("action")

            if action == "wrap_label":
                # Convert <Input label="X" ...> to <label>X</label>\n<Input ...>
                # This needs special handling since we're adding content outside the tag
                label_re = re.compile(
                    r'(<' + re.escape(component) + r'\b)'
                    r'([^>]*?)'
                    r'\s+label="([^"]*)"'
                    r'([^>]*?)'
                    r'(\s*/?>)',
                    re.DOTALL,
                )
                count = [0]
                def _wrap_label(m, _count=count):
                    tag_start = m.group(1)
                    before = m.group(2)
                    label_text = m.group(3)
                    after = m.group(4)
                    tag_end = m.group(5)
                    _count[0] += 1
                    # Determine indentation from the tag start
                    line_start = content.rfind('\n', 0, m.start())
                    indent = ''
                    if line_start >= 0:
                        indent_match = re.match(r'(\s*)', content[line_start + 1:m.start() + 1])
                        if indent_match:
                            indent = indent_match.group(1)
                    return (
                        f'<label className="text-sm text-gray-400">{label_text}</label>\n'
                        f'{indent}{tag_start}{before}{after}{tag_end}'
                    )

                new_content = label_re.sub(_wrap_label, content)
                if count[0]:
                    result.changes.append(
                        f"Converted `label` prop on <{component}> to wrapping <label> "
                        f"({count[0]} occurrence{'s' if count[0] > 1 else ''})"
                    )
                    result.changed = True
                    if transform.get("flag"):
                        result.flags.append(transform["flag"])
                content = new_content
                continue

            if action == "convert_onValueChange":
                # Convert onValueChange={setFoo} to onChange={(e) => setFoo(e.target.value)}
                ovr_re = re.compile(
                    r'(<' + re.escape(component) + r'\b[^>]*?)'
                    r'\s+onValueChange=\{([^{}]+)\}'
                    r'([^>]*?>)',
                    re.DOTALL,
                )
                count = [0]
                def _convert_ovc(m, _count=count):
                    before = m.group(1)
                    handler = m.group(2).strip()
                    after = m.group(3)
                    _count[0] += 1
                    return f'{before} onChange={{(e) => {handler}(e.target.value)}}{after}'

                new_content = ovr_re.sub(_convert_ovc, content)
                if count[0]:
                    result.changes.append(
                        f"Converted `onValueChange` on <{component}> to `onChange` "
                        f"({count[0]} occurrence{'s' if count[0] > 1 else ''})"
                    )
                    result.changed = True
                content = new_content
                continue

            # Handle rename and value_map transforms
            rename_to = transform.get("rename")
            value_map = transform.get("value_map")

            if not rename_to:
                continue

            count = [0]

            def _transform_tag(m, _prop=prop_name, _rename=rename_to,
                               _vmap=value_map, _count=count):
                tag_start, attrs, tag_end = m.group(1), m.group(2), m.group(3)

                extracted = _extract_prop_value(attrs, _prop)
                if extracted is None:
                    return m.group(0)

                value_str, quote_char, is_expr, full_match = extracted

                if _vmap and value_str is not None and not is_expr:
                    # Map the value
                    new_val = _vmap.get(value_str, value_str)
                    new_prop = f' {_rename}="{new_val}"'
                elif _prop != _rename:
                    # Just rename the prop
                    if value_str is None:
                        # Boolean prop
                        new_prop = f' {_rename}'
                    elif is_expr:
                        new_prop = f' {_rename}={{{value_str}}}'
                    else:
                        new_prop = f' {_rename}={quote_char}{value_str}{quote_char}'
                else:
                    # Same name, apply value map only
                    if _vmap and value_str is not None and not is_expr:
                        new_val = _vmap.get(value_str, value_str)
                        new_prop = f' {_rename}="{new_val}"'
                    else:
                        return m.group(0)

                _count[0] += 1
                new_attrs = attrs.replace(full_match, new_prop)

                # If both color→variant and existing variant, merge:
                # remove the old variant since we just set a new one
                if _prop == "color" and _rename == "variant":
                    # Check if there was already a variant prop (now duplicated)
                    variant_matches = list(re.finditer(
                        r'\s+variant="[^"]*"', new_attrs
                    ))
                    if len(variant_matches) > 1:
                        # Keep the last one (from color transform), remove the first
                        new_attrs = new_attrs[:variant_matches[0].start()] + \
                                    new_attrs[variant_matches[0].end():]

                return tag_start + new_attrs + tag_end

            content = tag_re.sub(_transform_tag, content)

            if count[0]:
                if value_map:
                    result.changes.append(
                        f"Transformed `{prop_name}` → `{rename_to}` on <{component}> "
                        f"with value mapping ({count[0]} occurrence{'s' if count[0] > 1 else ''})"
                    )
                elif prop_name != rename_to:
                    result.changes.append(
                        f"Renamed `{prop_name}` → `{rename_to}` on <{component}> "
                        f"({count[0]} occurrence{'s' if count[0] > 1 else ''})"
                    )
                result.changed = True
                if transform.get("flag"):
                    result.flags.append(transform["flag"])

    return content


# ─── Flags (no auto-fix) ─────────────────────────────────────────────────────

def flag_removed_component_usages(content: str, result: FileResult, removed_from_import: set):
    """Flag JSX usages of components we removed from imports."""
    for comp in removed_from_import:
        if comp in REMOVED_COMPONENT_NOTES:
            if re.search(r'<' + re.escape(comp) + r'[\s/>]', content):
                result.flags.append(
                    f"REMOVED COMPONENT <{comp}>: {REMOVED_COMPONENT_NOTES[comp]}"
                )


def flag_structural_changes(content: str, result: FileResult):
    """Flag components whose structure changed in v3 for visual verification."""
    for comp, note in STRUCTURAL_CHANGE_NOTES.items():
        if re.search(r'<' + re.escape(comp) + r'[\s/>]', content):
            result.flags.append(f"VERIFY — {note}")


def flag_select_with_direct_items(content: str, result: FileResult):
    """
    Detect <Select> or <Autocomplete> elements that contain direct <ListBoxItem>
    children — this pattern crashes in v3 SSR.  Emit targeted fix instructions.
    """
    # Find each <Select ...> ... </Select> block (non-greedy, handles props)
    select_block_re = re.compile(
        r'<Select(\b[^>]*)>(.*?)</Select>',
        re.DOTALL,
    )
    for m in select_block_re.finditer(content):
        props, body = m.group(1), m.group(2)
        if not re.search(r'<ListBoxItem[\s/>]', body):
            continue
        if re.search(r'selectionMode=["\']multiple["\']', props):
            result.flags.append(
                'ACTION REQUIRED — <Select selectionMode="multiple"> with direct '
                '<ListBoxItem> children crashes in v3 SSR. '
                'Replace with <ListBox selectionMode="multiple"> '
                '(and import ListBox from @heroui/react). '
                'Add a <p> or <label> above it for the label text.'
            )
        else:
            result.flags.append(
                'ACTION REQUIRED — <Select> with direct <ListBoxItem> children crashes '
                'in v3 SSR. Migrate to compound pattern: '
                '<SelectRoot><SelectTrigger><SelectValue/><SelectIndicator/></SelectTrigger>'
                '<SelectPopover><ListBox><ListBoxItem .../></ListBox></SelectPopover></SelectRoot>. '
                'Imports: SelectRoot, SelectTrigger, SelectValue, SelectIndicator, '
                'SelectPopover, ListBox from @heroui/react.'
            )

    # Same check for Autocomplete
    autocomplete_block_re = re.compile(
        r'<Autocomplete(\b[^>]*)>(.*?)</Autocomplete>',
        re.DOTALL,
    )
    for m in autocomplete_block_re.finditer(content):
        body = m.group(2)
        if not re.search(r'<ListBoxItem[\s/>]', body):
            continue
        result.flags.append(
            'ACTION REQUIRED — <Autocomplete> with direct <ListBoxItem> children may '
            'crash in v3 SSR. Migrate to compound pattern: '
            '<AutocompleteRoot><AutocompleteTrigger/><AutocompleteFilter/>'
            '<AutocompletePopover><ListBox><ListBoxItem .../></ListBox></AutocompletePopover>'
            '</AutocompleteRoot>. '
            'Imports: AutocompleteRoot, AutocompleteTrigger, AutocompleteFilter, '
            'AutocompletePopover, ListBox from @heroui/react.'
        )


# ─── Config/CSS transforms ───────────────────────────────────────────────────

def rewrite_tailwind_config(content: str, result: FileResult) -> str:
    """Remove heroui() plugin from tailwind config."""
    changed = False

    # Remove require/import of heroui from @heroui/react
    for pat in [
        re.compile(r'const\s*\{[^}]*\bheroui\b[^}]*\}\s*=\s*require\(["\']@heroui/react["\']\)[^\n]*\n'),
        re.compile(r'import\s*\{[^}]*\bheroui\b[^}]*\}\s*from\s*["\']@heroui/react["\']\s*;?\n'),
    ]:
        if pat.search(content):
            content = pat.sub('', content)
            changed = True

    # Remove heroui({...}) or heroui() from plugins array
    for pat in [
        re.compile(r',?\s*heroui\(\s*\{[^}]*\}\s*\)\s*'),  # heroui({...})
        re.compile(r',?\s*heroui\(\s*\)\s*'),               # heroui()
    ]:
        if pat.search(content):
            content = pat.sub('', content)
            changed = True
            break

    # Remove now-empty plugins array
    empty_plugins = re.compile(r',?\s*plugins:\s*\[\s*\],?')
    if empty_plugins.search(content):
        content = empty_plugins.sub('', content)

    if changed:
        result.changes.append("Removed heroui() Tailwind plugin")
        result.changed = True

    return content


def rewrite_css(content: str, result: FileResult) -> str:
    """Add @import "@heroui/styles" if not already present."""
    if '@heroui/styles' in content:
        return content

    # Insert after @import "tailwindcss"
    tw_re = re.compile(r'(@import\s+["\']tailwindcss["\']\s*;?\n?)')
    if tw_re.search(content):
        content = tw_re.sub(r'\1@import "@heroui/styles";\n', content, count=1)
        result.changes.append('Added @import "@heroui/styles"')
        result.changed = True
        return content

    # Insert after last @tailwind utilities (Tailwind v3 style)
    tw3_re = re.compile(r'(@tailwind\s+utilities\s*;?\n?)')
    matches = list(tw3_re.finditer(content))
    if matches:
        end = matches[-1].end()
        content = content[:end] + '@import "@heroui/styles";\n' + content[end:]
        result.changes.append('Added @import "@heroui/styles"')
        result.changed = True

    return content


# ─── File dispatch ────────────────────────────────────────────────────────────

def transform_file(filepath: str, dry_run: bool) -> FileResult:
    result = FileResult(path=filepath)

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except (IOError, UnicodeDecodeError) as e:
        result.flags.append(f"Could not read file: {e}")
        return result

    original = content
    fname = os.path.basename(filepath)

    # Route to the right handler
    if re.search(r'tailwind\.config\.(ts|js|cjs|mjs)$', fname):
        content = rewrite_tailwind_config(content, result)

    elif filepath.endswith('.css'):
        content = rewrite_css(content, result)

    elif filepath.endswith(('.ts', '.tsx', '.js', '.jsx')):
        # Skip files with no HeroUI content at all
        if '@heroui' not in content and 'HeroUIProvider' not in content:
            return result

        # 1. Rewrite imports
        content, lucide_icons = transform_imports(content, result)

        # Merge any duplicate lucide-react imports created by the replacement
        content = merge_lucide_import(content, lucide_icons)

        # 2. Remove HeroUIProvider wrapper
        content = remove_heroui_provider(content, result)

        # 3. Rename JSX elements
        content = rename_jsx_elements(content, result)

        # 3b. Strip props removed in v3 (runs after rename so names are final)
        content = strip_removed_props(content, result)

        # 3c. Transform props (color→variant, isLoading→isPending, label→wrapping, etc.)
        content = apply_prop_transforms(content, result)

        # 4. Add id prop to ListBoxItem elements (after rename)
        content = add_id_prop_to_list_box_items(content, result)

        # 5. Flag removed components still referenced in JSX
        # Determine which names were removed from imports
        removed_in_this_file = REMOVED_FROM_HEROUI & set(
            re.findall(r'\b(' + '|'.join(re.escape(n) for n in REMOVED_FROM_HEROUI) + r')\b',
                       original)
        )
        flag_removed_component_usages(content, result, removed_in_this_file)

        # 6. Flag structural changes for verification
        flag_structural_changes(content, result)

        # 7. Flag Select/Autocomplete with direct ListBoxItem children (v3 SSR crash)
        flag_select_with_direct_items(content, result)

    if content != original:
        result.changed = True
        if not dry_run:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)

    return result


# ─── File discovery ───────────────────────────────────────────────────────────

SKIP_DIRS = {'node_modules', '.git', 'build', 'dist', '.next', '.nuxt',
             '__pycache__', '.cache', 'coverage', '.turbo'}

CODE_EXTS = {'.ts', '.tsx', '.js', '.jsx', '.css'}


def find_files(directory: str) -> list:
    files = []
    for root, dirs, filenames in os.walk(directory):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fname in filenames:
            path = os.path.join(root, fname)
            _, ext = os.path.splitext(fname)
            if ext in CODE_EXTS or re.search(r'tailwind\.config\.(ts|js|cjs|mjs)$', fname):
                files.append(path)
    return sorted(files)


# ─── Report writer ────────────────────────────────────────────────────────────

def write_report(results: list, output_dir: str) -> str:
    report_path = os.path.join(output_dir, 'heroui-migration-report.md')

    changed = [r for r in results if r.changed]
    flagged = [r for r in results if r.flags]

    lines = [
        '# HeroUI v2 → v3 Migration Report\n',
        f'**Files scanned:** {len(results)}  ',
        f'**Files changed:** {len(changed)}  ',
        f'**Files with manual items:** {len(flagged)}  \n',
    ]

    if changed:
        lines.append('## Automatic Changes Applied\n')
        for r in changed:
            lines.append(f'### `{r.path}`\n')
            for c in r.changes:
                lines.append(f'- {c}')
            lines.append('')

    if flagged:
        lines.append('## Manual Review Required\n')
        for r in flagged:
            lines.append(f'### `{r.path}`\n')
            for f_ in r.flags:
                lines.append(f'- ⚠️  {f_}')
            lines.append('')

    if not changed and not flagged:
        lines.append('No HeroUI v2 usage found — nothing to migrate.\n')

    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    return report_path


# ─── ANSI helpers ─────────────────────────────────────────────────────────────

def _green(s):  return f'\033[32m{s}\033[0m'
def _yellow(s): return f'\033[33m{s}\033[0m'
def _cyan(s):   return f'\033[36m{s}\033[0m'
def _bold(s):   return f'\033[1m{s}\033[0m'


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Migrate HeroUI v2 imports and components to v3.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('directory', help='Directory to scan and transform')
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview changes without writing files')
    parser.add_argument('--report', action='store_true',
                        help='Always write heroui-migration-report.md')
    args = parser.parse_args()

    directory = os.path.abspath(args.directory)
    if not os.path.isdir(directory):
        print(f'Error: "{directory}" is not a directory', file=sys.stderr)
        sys.exit(1)

    mode = _yellow('[DRY RUN] ') if args.dry_run else ''
    print(f'{mode}{_bold("HeroUI v2 → v3 migration")} — scanning {_cyan(directory)}\n')

    files = find_files(directory)
    results = []

    for filepath in files:
        result = transform_file(filepath, dry_run=args.dry_run)
        results.append(result)

        if not result.changed and not result.flags:
            continue

        rel = os.path.relpath(filepath, directory)
        tags = []
        if result.changed:
            tags.append(_green('[CHANGED]'))
        if result.flags:
            tags.append(_yellow('[FLAGGED]'))
        print(f"{'  '.join(tags)} {rel}")

        for c in result.changes:
            print(f'    + {c}')
        for f_ in result.flags:
            print(f'    {_yellow("⚠")}  {f_}')

    # Summary
    n_changed = sum(1 for r in results if r.changed)
    n_flagged = sum(1 for r in results if r.flags)

    print(f'\n{"─" * 60}')
    print(f'Files scanned : {len(results)}')
    print(f'Files changed : {_green(str(n_changed))}')
    print(f'Files flagged : {_yellow(str(n_flagged))}')

    if args.dry_run:
        print(_yellow('\n(Dry run — no files were modified)'))

    if args.report or n_flagged > 0:
        report_path = write_report(results, directory)
        print(f'\nReport → {_cyan(report_path)}')

    if n_flagged > 0:
        print('\nReview flagged items before building.')


if __name__ == '__main__':
    main()
