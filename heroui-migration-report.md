# HeroUI v2 → v3 Migration Report

**Files scanned:** 32  
**Files changed:** 5  
**Files with manual items:** 5  

## Automatic Changes Applied

### `/Users/noah/dev/tome-bingo/app/routes/_index.tsx`

- Removed from @heroui/react: SharedSelection
- Renamed in @heroui/react import: Divider→Separator, SelectItem→ListBoxItem
- Renamed JSX elements: <Divider>→<Separator>, <SelectItem>→<ListBoxItem>
- Added id prop to ListBoxItem elements (react-aria selection key)

### `/Users/noah/dev/tome-bingo/app/routes/admin.tsx`

- Removed from @heroui/react: getKeyValue
- Renamed in @heroui/react import: AutocompleteItem→ListBoxItem, Divider→Separator
- Renamed JSX elements: <AutocompleteItem>→<ListBoxItem>, <Divider>→<Separator>
- Added id prop to ListBoxItem elements (react-aria selection key)

### `/Users/noah/dev/tome-bingo/app/routes/create/create.homeroom.tsx`

- Renamed in @heroui/react import: AutocompleteItem→ListBoxItem
- Renamed JSX elements: <AutocompleteItem>→<ListBoxItem>
- Added id prop to ListBoxItem elements (react-aria selection key)

### `/Users/noah/dev/tome-bingo/app/routes/edit/edit.homeroom.$value.tsx`

- Renamed in @heroui/react import: AutocompleteItem→ListBoxItem
- Renamed JSX elements: <AutocompleteItem>→<ListBoxItem>
- Added id prop to ListBoxItem elements (react-aria selection key)

### `/Users/noah/dev/tome-bingo/app/routes/edit/edit.student.$value.tsx`

- Renamed in @heroui/react import: SelectItem→ListBoxItem
- Renamed JSX elements: <SelectItem>→<ListBoxItem>
- Added id prop to ListBoxItem elements (react-aria selection key)

## Manual Review Required

### `/Users/noah/dev/tome-bingo/app/routes/_index.tsx`

- ⚠️  Removed import 'SharedSelection': Replace type with: import type { Selection } from 'react-aria-components'
- ⚠️  VERIFY — Select v3: children now use ListBoxItem; onSelectionChange receives Selection (react-aria)
- ⚠️  VERIFY — Popover exists in v3; PopoverContent still present — verify visually

### `/Users/noah/dev/tome-bingo/app/routes/admin.tsx`

- ⚠️  Removed import 'getKeyValue': Replace call sites: getKeyValue(item, key) → (item as any)[key]
- ⚠️  VERIFY — Autocomplete v3: children use ListBoxItem — verify items render correctly
- ⚠️  VERIFY — Table exists in v3; some sub-component names may differ — verify visually

### `/Users/noah/dev/tome-bingo/app/routes/create/create.homeroom.tsx`

- ⚠️  VERIFY — Autocomplete v3: children use ListBoxItem — verify items render correctly

### `/Users/noah/dev/tome-bingo/app/routes/edit/edit.homeroom.$value.tsx`

- ⚠️  VERIFY — Autocomplete v3: children use ListBoxItem — verify items render correctly

### `/Users/noah/dev/tome-bingo/app/routes/edit/edit.student.$value.tsx`

- ⚠️  VERIFY — Select v3: children now use ListBoxItem; onSelectionChange receives Selection (react-aria)

