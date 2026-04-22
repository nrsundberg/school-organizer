# Drill Templates — Global Library Proposal

Research-backed plan for seeding a library of out-of-the-box drill templates schools can clone, plus a schema/rename recommendation.

## TL;DR

1. **Rename the feature**: `FireDrillTemplate` → `DrillTemplate`. "Fire Drill" is actively misleading — the most common school drills today (lockdown, reunification, shelter-in-place) aren't fires. The schema comment already says `"e.g. fire drill, lockdown"`, so the intent was always broader.
2. **Seed 10–12 global templates** grounded in the Standard Response Protocol (SRP) and NFPA / FEMA guidance.
3. **No breaking schema changes required** for v1 — current `{ columns, rows }` model covers ~10 of 12 proposed templates. Optional non-breaking additions (`drillType`, `authority`, `instructions`, `isGlobal`, `sectionId`) would make templates feel native rather than spreadsheet-y.

## Standards landscape

- ~45 US states mandate school drills; counts and types vary by state.
- **De-facto national taxonomy: Standard Response Protocol (SRP)** from the "I Love U Guys" Foundation — five actions: **Hold, Secure, Lockdown, Evacuate, Shelter** — plus the **Standard Reunification Method (SRM)**. Adopted by NY state DOE, Texas School Safety Center, and thousands of districts.
- **NFPA 101** drives fire-drill frequency; **NFPA 1600** drives the all-hazards program structure.
- **FEMA / REMS TA Center** "Guide for Developing High-Quality School Emergency Operations Plans" is the federal reference.

Adopting SRP vocabulary in our templates makes them instantly legible to any school safety officer.

## Proposed global templates (prioritized)

| # | Name | Description | Source | Schema deltas |
|---|---|---|---|---|
| 1 | Fire Evacuation | Full evacuation via primary egress to assembly point; roll by class. | NFPA 101, state fire marshal | Fits as-is. Optional "assembly point" text per row. |
| 2 | Lockdown (SRP) | "Locks, Lights, Out of Sight" — violent intruder inside/imminent. | SRP v4.2 | Staff-action checklist rows. Missing/extra students text field. |
| 3 | Secure (SRP) | "Get Inside. Lock Outside Doors." — threat outside, business continues inside. | SRP v4.2 | Perimeter-door checklist (not class-roll). Benefits from row sectioning. |
| 4 | Hold (SRP) | "In Your Room. Clear the Halls." — internal issue (medical, fight). | SRP v4.2 | Needs freeform instructions / directive field (not in current schema). |
| 5 | Evacuate (non-fire) | Relocate off-site or to secondary site; bomb-threat, gas leak, HVAC. | SRP v4.2, FEMA EOP | Off-site reunification location; items-to-take checklist. |
| 6 | Shelter-in-Place (Hazmat) | Seal room, shut HVAC — chemical/smoke/air-quality event. | FEMA, EPA | HVAC-shutoff toggle + room-seal checklist. Fits current columns. |
| 7 | Severe Weather / Tornado | Move to interior low-level shelter; drop & cover. | NWS, state statutes | Shelter-zone assignment per class (text column). Fits. |
| 8 | Earthquake — Drop, Cover, Hold On | Seismic response + post-quake evac. | Great ShakeOut, CA/OR/WA statute | Two-phase (during + after) — benefits from step ordering. |
| 9 | Reunification (SRM) | Parent-student reunification after evacuation. | "I Love U Guys" SRM | Parent/guardian intake columns. Fits as more text columns. |
| 10 | Bus Evacuation | Front/rear/split bus evacuation drill. | NHTSA, state DOE | Per-student roll + driver-action checklist. Fits. |
| 11 | Bomb Threat / Suspicious Package | Threat-assessment checklist + evacuate-or-search decision. | DHS/CISA Bomb Threat Checklist | Caller-info intake form (many conditional text fields). Stretches current shape. |
| 12 | Medical Emergency / AED Response | Scene-safety, 911, AED, CPR roles. | AHA, state Good Samaritan | Role-assignment checklist. Fits. |

Lower-priority regional add-ons worth considering later: Tsunami (coastal), Wildfire smoke / air quality, Off-campus Secure, Field-trip emergency.

## Optional schema additions (non-breaking)

Not required for v1 — everything above can be coerced into rows + text/toggle columns. To make templates feel native:

- `drillType` enum — `FIRE | LOCKDOWN | SECURE | HOLD | EVACUATE | SHELTER | SEVERE_WEATHER | EARTHQUAKE | REUNIFICATION | BUS | BOMB_THREAT | MEDICAL | OTHER`.
- `authority` / `source` string — e.g. `"SRP v4.2"`, `"NFPA 101"`.
- `instructions` markdown block — the "directive" / action card text teachers read before running the drill.
- `isGlobal` + `globalKey` — so orgs can clone a master, and we can push updates/migrations when standards change.
- Optional row `sectionId` — template rows group into sections (e.g. "During" vs "After" for earthquake, "Staff actions" vs "Student roll" for lockdown).

## Naming & rename plan

**Rename the feature to "Drill Templates."** Short, matches industry vocabulary (SRP, NFPA, state DOEs all say "drill"). "Safety Drill Templates" is a decent second choice. Avoid "Emergency Drill" — "emergency" implies a live incident, not practice.

Mechanical rename scope (best done before global library ships so URLs/model names don't change twice):

- Route namespace: `/admin/fire-drill` → `/admin/drills` (with a redirect from the old route)
- Prisma model: `FireDrillTemplate` → `DrillTemplate`, `FireDrillRun` → `DrillRun`
- Domain folder: `app/domain/fire-drill` → `app/domain/drills`
- DB migration: `ALTER TABLE FireDrillTemplate RENAME TO DrillTemplate`, same for runs

## Sources

- [SRP K-12 v4.2 Operational Guidance — I Love U Guys](https://iloveuguys.org/downloads/SRP%20K12%202025%20Operational%20Guidance%20V4.2.pdf)
- [SRP Overview — I Love U Guys Foundation](https://iloveuguys.org/The-Standard-Response-Protocol.html)
- [K-12 SRP Toolkit — Texas School Safety Center](https://txssc.txstate.edu/tools/srp-toolkit/drills)
- [NYSED — SRP & Standard Reunification Method](https://www.nysed.gov/student-support-services/standard-response-protocol-and-standard-reunification-method)
- [FEMA/DHS REMS — Guide for Developing High-Quality School EOPs](https://www.dhs.gov/sites/default/files/publications/REMS%20K-12%20Guide%20508_0.pdf)
- [NFPA 1600 Standard](https://www.nfpa.org/codes-and-standards/nfpa-1600-standard-development/1600)
- [ECS — K-12 School Safety state comparison](https://reports.ecs.org/comparisons/k-12-school-safety-2022-04)
- [Ohio School Boards — Bus Evacuation Drill Form](https://www.ohioschoolboards.org/sites/default/files/uploads/Transportation/Programs%20state-federal/School%20Bus%20Evacuation%20Drill%20Form.pdf)
