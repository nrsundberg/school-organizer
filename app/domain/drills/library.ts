// app/domain/drills/library.ts
//
// Seed data for the Drill Templates global library.
//
// These are constant, hand-authored templates — not a DB seed and not a
// migration. They are designed to be cloned into an org's own template list,
// so each ColumnDef / RowDef id is a fixed kebab-case slug rather than a
// UUID. That stability lets us push template updates over time (matching on
// `globalKey` + column/row ids) without orphaning existing run data.
//
// Wording for SRP-derived templates follows the "I Love U Guys" Foundation
// Standard Response Protocol K-12 Operational Guidance v4.2 (2025).
//   Source: https://iloveuguys.org/The-Standard-Response-Protocol.html
//   PDF:    https://iloveuguys.org/downloads/SRP%20K12%202025%20Operational%20Guidance%20V4.2.pdf
// If SRP publishes a v4.3+ revision, re-verify the directive language below.

import type { DrillType, TemplateDefinition } from "./types";

export interface GlobalDrillTemplate {
  /** Stable slug, e.g. "fire-evacuation". Used for upgrades / migrations. */
  globalKey: string;
  /** Display name in the library picker. */
  name: string;
  drillType: DrillType;
  /** Source / standards body, e.g. "NFPA 101", "SRP v4.2". */
  authority: string;
  /** One-line description for the library picker. */
  description: string;
  /** Markdown directive text the admin reads before running the drill. */
  instructions: string;
  /** Columns + rows + optional row sections. Uses fixed kebab-case ids. */
  definition: TemplateDefinition;
}

// ---------------------------------------------------------------------------
// 1. Fire Evacuation (NFPA 101)
// ---------------------------------------------------------------------------
const FIRE_EVACUATION: GlobalDrillTemplate = {
  globalKey: "fire-evacuation",
  name: "Fire Evacuation",
  drillType: "FIRE",
  authority: "NFPA 101",
  description:
    "Full building evacuation via primary egress to the outdoor assembly point; class-by-class roll.",
  instructions: [
    "**Fire Evacuation Drill** — per NFPA 101 Life Safety Code.",
    "",
    "On alarm: stop instruction, take attendance roster and go-bag, lead students single-file to the assigned assembly point via the primary egress route. If the primary route is blocked, use the posted secondary route.",
    "",
    "Once at the assembly point, take roll, mark each class **Checked In**, and report any **Missing Students** to the incident commander immediately. Do not re-enter the building until the fire department gives an all-clear.",
  ].join("\n"),
  definition: {
    columns: [
      { id: "grade", label: "Grade / Class", kind: "text" },
      { id: "teacher", label: "Teacher", kind: "text" },
      { id: "checked-in", label: "Checked In", kind: "toggle" },
      { id: "missing-students", label: "Missing Students", kind: "text" },
      { id: "assembly-point", label: "Assembly Point", kind: "text" },
    ],
    rows: [
      { id: "grade-k", cells: { grade: "K", teacher: "", "missing-students": "", "assembly-point": "Field A" } },
      { id: "grade-1", cells: { grade: "1", teacher: "", "missing-students": "", "assembly-point": "Field A" } },
      { id: "grade-2", cells: { grade: "2", teacher: "", "missing-students": "", "assembly-point": "Field A" } },
      { id: "grade-3", cells: { grade: "3", teacher: "", "missing-students": "", "assembly-point": "Field B" } },
      { id: "grade-4", cells: { grade: "4", teacher: "", "missing-students": "", "assembly-point": "Field B" } },
      { id: "grade-5", cells: { grade: "5", teacher: "", "missing-students": "", "assembly-point": "Field B" } },
      { id: "specials", cells: { grade: "Specials (Art/Music/PE)", teacher: "", "missing-students": "", "assembly-point": "Field A" } },
    ],
  },
};

// ---------------------------------------------------------------------------
// 2. Lockdown (SRP v4.2)
// ---------------------------------------------------------------------------
const LOCKDOWN_SRP: GlobalDrillTemplate = {
  globalKey: "lockdown-srp",
  name: "Lockdown (SRP)",
  drillType: "LOCKDOWN",
  authority: "SRP v4.2",
  description:
    'SRP Lockdown — "Locks, Lights, Out of Sight." Threat is inside or imminently threatening the building.',
  instructions: [
    '**Lockdown!** — SRP v4.2 directive: **"Locks, Lights, Out of Sight."**',
    "",
    "Students move out of sight and remain silent. Staff lock the classroom door, turn off the lights, cover any door windows, silence phones, and move students away from the door and windows. Do not open the door for anyone — first responders will use a master key or breach.",
    "",
    "Take silent attendance. Note any **missing** students (who should be present) and any **extra** students (who joined from the hall). Maintain lockdown until released by law enforcement, not over the PA.",
  ].join("\n"),
  definition: {
    sections: [
      { id: "staff-actions", label: "Staff Actions" },
      { id: "class-roll", label: "Class Roll" },
    ],
    columns: [
      { id: "item", label: "Item", kind: "text" },
      { id: "complete", label: "Complete", kind: "toggle" },
      { id: "grade", label: "Grade", kind: "text" },
      { id: "teacher", label: "Teacher", kind: "text" },
      { id: "present", label: "Present", kind: "toggle" },
      { id: "missing", label: "Missing", kind: "text" },
      { id: "extra", label: "Extra", kind: "text" },
    ],
    rows: [
      { id: "action-lock-door", sectionId: "staff-actions", cells: { item: "Lock classroom door" } },
      { id: "action-lights-off", sectionId: "staff-actions", cells: { item: "Lights off" } },
      { id: "action-cover-window", sectionId: "staff-actions", cells: { item: "Cover door window" } },
      { id: "action-out-of-sight", sectionId: "staff-actions", cells: { item: "Move students out of sight" } },
      { id: "action-silence-phones", sectionId: "staff-actions", cells: { item: "Silence phones (students + staff)" } },
      { id: "action-silent-roll", sectionId: "staff-actions", cells: { item: "Take silent attendance" } },
      { id: "action-report-status", sectionId: "staff-actions", cells: { item: "Report status (missing / extra / injured)" } },

      { id: "roll-grade-k", sectionId: "class-roll", cells: { grade: "K", teacher: "", missing: "", extra: "" } },
      { id: "roll-grade-1", sectionId: "class-roll", cells: { grade: "1", teacher: "", missing: "", extra: "" } },
      { id: "roll-grade-2", sectionId: "class-roll", cells: { grade: "2", teacher: "", missing: "", extra: "" } },
      { id: "roll-grade-3", sectionId: "class-roll", cells: { grade: "3", teacher: "", missing: "", extra: "" } },
      { id: "roll-grade-4", sectionId: "class-roll", cells: { grade: "4", teacher: "", missing: "", extra: "" } },
      { id: "roll-grade-5", sectionId: "class-roll", cells: { grade: "5", teacher: "", missing: "", extra: "" } },
      { id: "roll-specials", sectionId: "class-roll", cells: { grade: "Specials", teacher: "", missing: "", extra: "" } },
    ],
  },
};

// ---------------------------------------------------------------------------
// 3. Secure (SRP v4.2)
// ---------------------------------------------------------------------------
const SECURE_SRP: GlobalDrillTemplate = {
  globalKey: "secure-srp",
  name: "Secure (SRP)",
  drillType: "SECURE",
  authority: "SRP v4.2",
  description:
    'SRP Secure — "Get Inside. Lock Outside Doors." Threat is outside the building; instruction continues inside.',
  instructions: [
    '**Secure!** — SRP v4.2 directive: **"Get Inside. Lock Outside Doors."**',
    "",
    "Bring everyone inside the building. Lock all exterior / perimeter doors. Account for students and staff. Increase situational awareness — but business continues inside (instruction proceeds, internal movement is allowed).",
    "",
    "Designated staff should walk the perimeter checklist below and confirm each entry point is locked. Note anything unusual.",
  ].join("\n"),
  definition: {
    sections: [{ id: "perimeter-check", label: "Perimeter Check" }],
    columns: [
      { id: "door", label: "Door / Entry Point", kind: "text" },
      { id: "locked", label: "Locked", kind: "toggle" },
      { id: "notes", label: "Notes", kind: "text" },
    ],
    rows: [
      { id: "door-main-entrance", sectionId: "perimeter-check", cells: { door: "Main Entrance", notes: "" } },
      { id: "door-side-east", sectionId: "perimeter-check", cells: { door: "East Side Door", notes: "" } },
      { id: "door-side-west", sectionId: "perimeter-check", cells: { door: "West Side Door", notes: "" } },
      { id: "door-gym", sectionId: "perimeter-check", cells: { door: "Gym Exterior Door", notes: "" } },
      { id: "door-cafeteria", sectionId: "perimeter-check", cells: { door: "Cafeteria / Loading Dock", notes: "" } },
      { id: "door-playground", sectionId: "perimeter-check", cells: { door: "Playground Door", notes: "" } },
      { id: "door-portables", sectionId: "perimeter-check", cells: { door: "Portables / Modular Classrooms", notes: "" } },
      { id: "door-bus-loop", sectionId: "perimeter-check", cells: { door: "Bus Loop Door", notes: "" } },
    ],
  },
};

// ---------------------------------------------------------------------------
// 4. Hold (SRP v4.2)
// ---------------------------------------------------------------------------
const HOLD_SRP: GlobalDrillTemplate = {
  globalKey: "hold-srp",
  name: "Hold (SRP)",
  drillType: "HOLD",
  authority: "SRP v4.2",
  description:
    'SRP Hold — "In Your Room. Clear the Halls." Used for internal issues like a medical event, fight, or maintenance.',
  instructions: [
    '**Hold!** — SRP v4.2 directive: **"In Your Room. Clear the Halls."**',
    "",
    "Staff in classrooms close and hold the door, keep all students inside, and continue instruction. Staff in hallways move students into the nearest classroom or supervised space. Do not lock doors (this is *not* a lockdown).",
    "",
    "Take attendance and hold until you receive an **All Clear**. Hold is typically used so administration or first responders can address an issue (medical, behavior, contractor) without hallway interference.",
  ].join("\n"),
  definition: {
    columns: [
      { id: "area", label: "Area", kind: "text" },
      { id: "cleared", label: "Cleared / In Place", kind: "toggle" },
      { id: "notes", label: "Notes", kind: "text" },
    ],
    rows: [
      { id: "hall-main", cells: { area: "Main Hallway", notes: "" } },
      { id: "hall-k-2", cells: { area: "K–2 Wing Hallway", notes: "" } },
      { id: "hall-3-5", cells: { area: "3–5 Wing Hallway", notes: "" } },
      { id: "restrooms", cells: { area: "Restrooms swept", notes: "" } },
      { id: "cafeteria", cells: { area: "Cafeteria / Commons", notes: "" } },
      { id: "library", cells: { area: "Library / Media Center", notes: "" } },
      { id: "office-area", cells: { area: "Office Area", notes: "" } },
    ],
  },
};

// ---------------------------------------------------------------------------
// 5. Evacuate — Off-Site (SRP v4.2 + FEMA)
// ---------------------------------------------------------------------------
const EVACUATE_OFFSITE: GlobalDrillTemplate = {
  globalKey: "evacuate-offsite",
  name: "Evacuate — Off-Site",
  drillType: "EVACUATE",
  authority: "SRP v4.2 + FEMA",
  description:
    "Relocation to a secondary off-site reunification location (gas leak, bomb threat, extended utility loss).",
  instructions: [
    "**Evacuate!** — SRP v4.2 directive specifies the **direction or location**, e.g. *Evacuate to the bus loop* or *Evacuate to [secondary site]*.",
    "",
    "Bring the **go-bag** (attendance roster, medical/medication list, emergency phone, classroom keys). Lead students in single file along the announced route. Account for everyone at the on-site assembly point first, then transport to the off-site reunification location per the EOP.",
    "",
    "At the off-site site, take roll a second time and confirm every student is accounted for before any reunification activity begins.",
  ].join("\n"),
  definition: {
    sections: [
      { id: "items-to-bring", label: "Items to Bring (Go-Bag)" },
      { id: "class-roll", label: "Class Roll" },
    ],
    columns: [
      { id: "item", label: "Item", kind: "text" },
      { id: "packed", label: "Packed", kind: "toggle" },
      { id: "class", label: "Class", kind: "text" },
      { id: "teacher", label: "Teacher", kind: "text" },
      { id: "at-assembly", label: "At Assembly", kind: "toggle" },
      { id: "at-offsite", label: "At Off-Site", kind: "toggle" },
      { id: "missing", label: "Missing", kind: "text" },
    ],
    rows: [
      { id: "bag-attendance", sectionId: "items-to-bring", cells: { item: "Attendance roster" } },
      { id: "bag-medical", sectionId: "items-to-bring", cells: { item: "Medical / medication list" } },
      { id: "bag-phone", sectionId: "items-to-bring", cells: { item: "Emergency phone / charger" } },
      { id: "bag-keys", sectionId: "items-to-bring", cells: { item: "Classroom + master keys" } },
      { id: "bag-radio", sectionId: "items-to-bring", cells: { item: "Two-way radio" } },
      { id: "bag-firstaid", sectionId: "items-to-bring", cells: { item: "First-aid kit" } },

      { id: "class-k", sectionId: "class-roll", cells: { class: "K", teacher: "", missing: "" } },
      { id: "class-1", sectionId: "class-roll", cells: { class: "1", teacher: "", missing: "" } },
      { id: "class-2", sectionId: "class-roll", cells: { class: "2", teacher: "", missing: "" } },
      { id: "class-3", sectionId: "class-roll", cells: { class: "3", teacher: "", missing: "" } },
      { id: "class-4", sectionId: "class-roll", cells: { class: "4", teacher: "", missing: "" } },
      { id: "class-5", sectionId: "class-roll", cells: { class: "5", teacher: "", missing: "" } },
      { id: "class-specials", sectionId: "class-roll", cells: { class: "Specials", teacher: "", missing: "" } },
    ],
  },
};

// ---------------------------------------------------------------------------
// 6. Shelter-in-Place (Hazmat) — FEMA / EPA
// ---------------------------------------------------------------------------
const SHELTER_HAZMAT: GlobalDrillTemplate = {
  globalKey: "shelter-hazmat",
  name: "Shelter-in-Place (Hazmat)",
  drillType: "SHELTER",
  authority: "FEMA / EPA",
  description:
    "Seal the building against outside air for a chemical, smoke, or air-quality event.",
  instructions: [
    "**Shelter-in-Place — Hazmat.** Per FEMA / EPA shelter guidance.",
    "",
    "Bring everyone inside immediately. Facilities shuts down HVAC, fans, and any system that draws outside air. Staff close and seal classroom doors, windows, and visible vents (use tape and plastic sheeting from the shelter kit if the event is prolonged).",
    "",
    "Account for all students. Do not exit until officials give an all-clear — outside air may still be contaminated.",
  ].join("\n"),
  definition: {
    sections: [
      { id: "building-systems", label: "Building Systems" },
      { id: "room-status", label: "Room-by-Room Status" },
    ],
    columns: [
      { id: "item", label: "Item", kind: "text" },
      { id: "done", label: "Done", kind: "toggle" },
      { id: "room", label: "Room", kind: "text" },
      { id: "doors-sealed", label: "Doors Sealed", kind: "toggle" },
      { id: "windows-sealed", label: "Windows Sealed", kind: "toggle" },
      { id: "vents-covered", label: "Vents Covered", kind: "toggle" },
      { id: "students-accounted", label: "Students Accounted", kind: "toggle" },
    ],
    rows: [
      { id: "system-hvac-off", sectionId: "building-systems", cells: { item: "HVAC / air handlers OFF" } },
      { id: "system-exhaust-off", sectionId: "building-systems", cells: { item: "Exhaust fans OFF (kitchen, restrooms)" } },
      { id: "system-outside-doors", sectionId: "building-systems", cells: { item: "Exterior doors closed" } },
      { id: "system-shelter-kit", sectionId: "building-systems", cells: { item: "Shelter kit retrieved (tape, plastic)" } },

      { id: "room-k-wing", sectionId: "room-status", cells: { room: "K Wing classrooms" } },
      { id: "room-1-2-wing", sectionId: "room-status", cells: { room: "Grade 1–2 Wing classrooms" } },
      { id: "room-3-5-wing", sectionId: "room-status", cells: { room: "Grade 3–5 Wing classrooms" } },
      { id: "room-gym", sectionId: "room-status", cells: { room: "Gym" } },
      { id: "room-cafeteria", sectionId: "room-status", cells: { room: "Cafeteria" } },
      { id: "room-library", sectionId: "room-status", cells: { room: "Library" } },
      { id: "room-office", sectionId: "room-status", cells: { room: "Office" } },
    ],
  },
};

// ---------------------------------------------------------------------------
// 7. Severe Weather / Tornado (NWS)
// ---------------------------------------------------------------------------
const SEVERE_WEATHER: GlobalDrillTemplate = {
  globalKey: "severe-weather-tornado",
  name: "Severe Weather / Tornado",
  drillType: "SEVERE_WEATHER",
  authority: "NWS",
  description:
    "Move to interior, low-level shelter zones; drop and cover until the all-clear.",
  instructions: [
    "**Severe Weather — Tornado.** Per NWS shelter guidance.",
    "",
    "On warning, move classes to their assigned interior shelter zones (lowest floor, away from windows, in small interior rooms or hallways). Avoid gyms, cafeterias, auditoriums, and any large free-span room.",
    "",
    "Once positioned, students assume the **drop & cover** position: kneel facing an interior wall, head down, hands clasped over the back of the neck. Hold position until the watch/warning is canceled.",
  ].join("\n"),
  definition: {
    columns: [
      { id: "class", label: "Class", kind: "text" },
      { id: "teacher", label: "Teacher", kind: "text" },
      { id: "shelter-zone", label: "Shelter Zone Assignment", kind: "text" },
      { id: "arrived", label: "Arrived", kind: "toggle" },
      { id: "drop-cover", label: "Drop & Cover Position", kind: "toggle" },
    ],
    rows: [
      { id: "class-k", cells: { class: "K", teacher: "", "shelter-zone": "Interior Hallway A (K Wing)" } },
      { id: "class-1", cells: { class: "1", teacher: "", "shelter-zone": "Interior Hallway A (K Wing)" } },
      { id: "class-2", cells: { class: "2", teacher: "", "shelter-zone": "Interior Hallway B (1–2 Wing)" } },
      { id: "class-3", cells: { class: "3", teacher: "", "shelter-zone": "Interior Hallway C (3–5 Wing)" } },
      { id: "class-4", cells: { class: "4", teacher: "", "shelter-zone": "Interior Hallway C (3–5 Wing)" } },
      { id: "class-5", cells: { class: "5", teacher: "", "shelter-zone": "Locker Room (interior)" } },
      { id: "class-specials", cells: { class: "Specials", teacher: "", "shelter-zone": "Nearest interior hallway" } },
    ],
  },
};

// ---------------------------------------------------------------------------
// 8. Earthquake — Drop, Cover, Hold On (Great ShakeOut)
// ---------------------------------------------------------------------------
const EARTHQUAKE_DCHO: GlobalDrillTemplate = {
  globalKey: "earthquake-drop-cover-hold",
  name: "Earthquake — Drop, Cover, Hold On",
  drillType: "EARTHQUAKE",
  authority: "Great ShakeOut",
  description:
    "Two-phase seismic response: protect during shaking, then evacuate and assess after.",
  instructions: [
    "**Earthquake — Drop, Cover, Hold On.** Per the Great ShakeOut / ECA protocol.",
    "",
    "**During shaking:** everyone immediately **drops** to hands and knees, takes **cover** under a sturdy desk or table (or against an interior wall away from windows and overhead hazards), and **holds on** until shaking stops. Do not run for exits — most injuries occur from falling objects, not building collapse.",
    "",
    "**After shaking:** assume aftershocks are imminent. Evacuate per the route, watching for fallen debris, broken glass, and downed power lines. Account for all students at the assembly point and check utilities (gas smell, water, electrical) before any re-entry.",
  ].join("\n"),
  definition: {
    sections: [
      { id: "during-shaking", label: "During Shaking" },
      { id: "after-shaking", label: "After Shaking" },
    ],
    columns: [
      { id: "class", label: "Class", kind: "text" },
      { id: "teacher", label: "Teacher", kind: "text" },
      { id: "drop-verified", label: "Drop / Cover / Hold Verified", kind: "toggle" },
      { id: "task", label: "Task", kind: "text" },
      { id: "complete", label: "Complete", kind: "toggle" },
      { id: "notes", label: "Notes", kind: "text" },
    ],
    rows: [
      { id: "during-k", sectionId: "during-shaking", cells: { class: "K", teacher: "" } },
      { id: "during-1", sectionId: "during-shaking", cells: { class: "1", teacher: "" } },
      { id: "during-2", sectionId: "during-shaking", cells: { class: "2", teacher: "" } },
      { id: "during-3", sectionId: "during-shaking", cells: { class: "3", teacher: "" } },
      { id: "during-4", sectionId: "during-shaking", cells: { class: "4", teacher: "" } },
      { id: "during-5", sectionId: "during-shaking", cells: { class: "5", teacher: "" } },
      { id: "during-specials", sectionId: "during-shaking", cells: { class: "Specials", teacher: "" } },

      { id: "after-evacuate", sectionId: "after-shaking", cells: { task: "Evacuate to outdoor assembly point", notes: "" } },
      { id: "after-account", sectionId: "after-shaking", cells: { task: "Account for all students + staff", notes: "" } },
      { id: "after-injuries", sectionId: "after-shaking", cells: { task: "Triage injuries; report to incident commander", notes: "" } },
      { id: "after-gas", sectionId: "after-shaking", cells: { task: "Check for gas leaks (smell test, no sparks)", notes: "" } },
      { id: "after-utilities", sectionId: "after-shaking", cells: { task: "Shut off utilities if damage suspected", notes: "" } },
      { id: "after-aftershock", sectionId: "after-shaking", cells: { task: "Brief students on aftershock procedure", notes: "" } },
      { id: "after-no-reentry", sectionId: "after-shaking", cells: { task: "No re-entry until building is inspected", notes: "" } },
    ],
  },
};

// ---------------------------------------------------------------------------
// 9. Reunification (SRM)
// ---------------------------------------------------------------------------
const REUNIFICATION_SRM: GlobalDrillTemplate = {
  globalKey: "reunification-srm",
  name: "Reunification (SRM)",
  drillType: "REUNIFICATION",
  authority: "SRM",
  description:
    "Controlled parent–student reunification after an evacuation, per the Standard Reunification Method.",
  instructions: [
    "**Reunification — Standard Reunification Method (SRM).** From the *I Love U Guys* Foundation.",
    "",
    "Set up two distinct areas: a **Reunification Check-In** (where guardians line up and present photo ID) and a **Student Holding Area** (kept separate from guardians). A runner brings the named student forward only after the guardian's ID and authorization to pick up have been verified against the emergency contact card.",
    "",
    "Log every release: who was picked up, who released them, and when. Never release a student to an unverified or unauthorized adult — direct them to a separate resolution station for review.",
  ].join("\n"),
  definition: {
    columns: [
      { id: "student-name", label: "Student Name", kind: "text" },
      { id: "guardian-name", label: "Guardian Name", kind: "text" },
      { id: "id-verified", label: "Guardian ID Verified", kind: "toggle" },
      { id: "relationship", label: "Relationship", kind: "text" },
      { id: "released-at", label: "Released At", kind: "text" },
      { id: "released-by", label: "Released By (Staff)", kind: "text" },
    ],
    rows: [
      { id: "release-1", cells: { "student-name": "", "guardian-name": "", relationship: "", "released-at": "", "released-by": "" } },
      { id: "release-2", cells: { "student-name": "", "guardian-name": "", relationship: "", "released-at": "", "released-by": "" } },
      { id: "release-3", cells: { "student-name": "", "guardian-name": "", relationship: "", "released-at": "", "released-by": "" } },
      { id: "release-4", cells: { "student-name": "", "guardian-name": "", relationship: "", "released-at": "", "released-by": "" } },
      { id: "release-5", cells: { "student-name": "", "guardian-name": "", relationship: "", "released-at": "", "released-by": "" } },
      { id: "release-6", cells: { "student-name": "", "guardian-name": "", relationship: "", "released-at": "", "released-by": "" } },
      { id: "release-7", cells: { "student-name": "", "guardian-name": "", relationship: "", "released-at": "", "released-by": "" } },
      { id: "release-8", cells: { "student-name": "", "guardian-name": "", relationship: "", "released-at": "", "released-by": "" } },
    ],
  },
};

// ---------------------------------------------------------------------------
// 10. Bus Evacuation (NHTSA)
// ---------------------------------------------------------------------------
const BUS_EVACUATION: GlobalDrillTemplate = {
  globalKey: "bus-evacuation",
  name: "Bus Evacuation",
  drillType: "BUS",
  authority: "NHTSA",
  description:
    "Front, rear, or split bus evacuation with student roll and driver action checklist.",
  instructions: [
    "**Bus Evacuation Drill.** Per NHTSA School Bus Driver In-Service Safety Series.",
    "",
    "Driver: place transmission in park, set the parking brake, **turn ignition off**, activate **hazards**, radio dispatch, and announce the evacuation type (front, rear, or split). Two older student helpers stand at the door to assist others off the bus.",
    "",
    "Lead all students to a safe assembly point at least 100 feet from the bus, in front of the bus and away from traffic. Take roll using the seating chart and confirm every student is **off the bus**.",
  ].join("\n"),
  definition: {
    sections: [
      { id: "driver-actions", label: "Driver Actions" },
      { id: "student-roll", label: "Student Roll" },
    ],
    columns: [
      { id: "item", label: "Item", kind: "text" },
      { id: "complete", label: "Complete", kind: "toggle" },
      { id: "student", label: "Student", kind: "text" },
      { id: "seat", label: "Seat #", kind: "text" },
      { id: "off-bus", label: "Off Bus", kind: "toggle" },
    ],
    rows: [
      { id: "driver-park", sectionId: "driver-actions", cells: { item: "Transmission in Park, parking brake set" } },
      { id: "driver-ignition", sectionId: "driver-actions", cells: { item: "Ignition OFF" } },
      { id: "driver-hazards", sectionId: "driver-actions", cells: { item: "Hazard lights ON" } },
      { id: "driver-radio", sectionId: "driver-actions", cells: { item: "Radio dispatch with location + nature" } },
      { id: "driver-announce", sectionId: "driver-actions", cells: { item: "Announce evacuation type (front/rear/split)" } },
      { id: "driver-helpers", sectionId: "driver-actions", cells: { item: "Assign two student helpers at exit" } },
      { id: "driver-walkthrough", sectionId: "driver-actions", cells: { item: "Walk-through to confirm bus is empty" } },
      { id: "driver-100ft", sectionId: "driver-actions", cells: { item: "Move group 100 ft from bus, away from traffic" } },

      { id: "seat-1", sectionId: "student-roll", cells: { student: "", seat: "1" } },
      { id: "seat-2", sectionId: "student-roll", cells: { student: "", seat: "2" } },
      { id: "seat-3", sectionId: "student-roll", cells: { student: "", seat: "3" } },
      { id: "seat-4", sectionId: "student-roll", cells: { student: "", seat: "4" } },
      { id: "seat-5", sectionId: "student-roll", cells: { student: "", seat: "5" } },
      { id: "seat-6", sectionId: "student-roll", cells: { student: "", seat: "6" } },
    ],
  },
};

// ---------------------------------------------------------------------------
// 11. Bomb Threat / Suspicious Package (DHS / CISA)
// ---------------------------------------------------------------------------
const BOMB_THREAT: GlobalDrillTemplate = {
  globalKey: "bomb-threat-suspicious-package",
  name: "Bomb Threat / Suspicious Package",
  drillType: "BOMB_THREAT",
  authority: "DHS / CISA",
  description:
    "Caller intake, threat assessment, and response actions per the DHS/CISA Bomb Threat Checklist.",
  instructions: [
    "**Bomb Threat / Suspicious Package.** Per DHS/CISA Bomb Threat Checklist.",
    "",
    "If the threat arrives by phone: **stay on the line**, do not hang up, and capture as much detail as possible — exact words, caller voice characteristics, background noise, claimed location and detonation time. Signal a colleague to notify administration and police silently.",
    "",
    "Do **not** use radios or cell phones near a suspicious package. Administration decides between Hold, Evacuate, or full off-site Evacuate based on the threat's specificity and credibility, in coordination with law enforcement.",
  ].join("\n"),
  definition: {
    sections: [
      { id: "caller-intake", label: "Caller Info Intake" },
      { id: "response-actions", label: "Response Actions" },
    ],
    columns: [
      { id: "field", label: "Field", kind: "text" },
      { id: "value", label: "Value / Notes", kind: "text" },
      { id: "action", label: "Action", kind: "text" },
      { id: "complete", label: "Complete", kind: "toggle" },
    ],
    rows: [
      { id: "intake-time", sectionId: "caller-intake", cells: { field: "Time of call", value: "" } },
      { id: "intake-voice", sectionId: "caller-intake", cells: { field: "Caller voice (gender, age, accent, tone)", value: "" } },
      { id: "intake-background", sectionId: "caller-intake", cells: { field: "Background noise", value: "" } },
      { id: "intake-exact-words", sectionId: "caller-intake", cells: { field: "Exact words of the threat", value: "" } },
      { id: "intake-threat-location", sectionId: "caller-intake", cells: { field: "Stated threat location", value: "" } },
      { id: "intake-threat-time", sectionId: "caller-intake", cells: { field: "Stated detonation / event time", value: "" } },
      { id: "intake-caller-id", sectionId: "caller-intake", cells: { field: "Caller ID / phone number captured", value: "" } },

      { id: "action-admin", sectionId: "response-actions", cells: { action: "Administration notified" } },
      { id: "action-police", sectionId: "response-actions", cells: { action: "Police / 911 called" } },
      { id: "action-no-radio", sectionId: "response-actions", cells: { action: "Radio + cell silence near suspect area" } },
      { id: "action-decision", sectionId: "response-actions", cells: { action: "Hold / Evacuate decision made" } },
      { id: "action-evacuate", sectionId: "response-actions", cells: { action: "Building evacuated (if directed)" } },
      { id: "action-search", sectionId: "response-actions", cells: { action: "Staff visual sweep (do NOT touch)" } },
      { id: "action-cleared", sectionId: "response-actions", cells: { action: "Building cleared by law enforcement" } },
    ],
  },
};

// ---------------------------------------------------------------------------
// 12. Medical Emergency / AED (AHA)
// ---------------------------------------------------------------------------
const MEDICAL_AED: GlobalDrillTemplate = {
  globalKey: "medical-aed",
  name: "Medical Emergency / AED",
  drillType: "MEDICAL",
  authority: "AHA",
  description:
    "Cardiac arrest / serious medical response: scene safety, 911, AED, CPR, and assigned roles.",
  instructions: [
    "**Medical Emergency — Cardiac Arrest / AED.** Per American Heart Association BLS guidelines.",
    "",
    "Confirm the **scene is safe**. Check responsiveness and breathing. If unresponsive and not breathing normally, **call 911**, **send a runner for the AED**, and **start CPR** immediately (push hard and fast in the center of the chest, ~100–120/min).",
    "",
    "Use the AED as soon as it arrives — follow the device's voice prompts, minimize interruptions to compressions, and rotate compressors every 2 minutes. Continue until EMS takes over.",
  ].join("\n"),
  definition: {
    sections: [
      { id: "immediate-actions", label: "Immediate Actions" },
      { id: "role-assignment", label: "Role Assignment" },
    ],
    columns: [
      { id: "step", label: "Step", kind: "text" },
      { id: "complete", label: "Complete", kind: "toggle" },
      { id: "role", label: "Role", kind: "text" },
      { id: "assigned-to", label: "Assigned To", kind: "text" },
    ],
    rows: [
      { id: "step-scene-safe", sectionId: "immediate-actions", cells: { step: "Scene confirmed safe" } },
      { id: "step-responsiveness", sectionId: "immediate-actions", cells: { step: "Responsiveness + breathing checked" } },
      { id: "step-911", sectionId: "immediate-actions", cells: { step: "911 called" } },
      { id: "step-aed-retrieved", sectionId: "immediate-actions", cells: { step: "AED retrieved" } },
      { id: "step-cpr-started", sectionId: "immediate-actions", cells: { step: "CPR started (compressions ~100–120/min)" } },
      { id: "step-aed-applied", sectionId: "immediate-actions", cells: { step: "AED pads applied; prompts followed" } },
      { id: "step-handoff", sectionId: "immediate-actions", cells: { step: "Hand-off to EMS on arrival" } },

      { id: "role-compressor", sectionId: "role-assignment", cells: { role: "Compressor (rotate every 2 min)", "assigned-to": "" } },
      { id: "role-ventilator", sectionId: "role-assignment", cells: { role: "Ventilator / Airway", "assigned-to": "" } },
      { id: "role-aed-operator", sectionId: "role-assignment", cells: { role: "AED Operator", "assigned-to": "" } },
      { id: "role-911-caller", sectionId: "role-assignment", cells: { role: "911 Caller", "assigned-to": "" } },
      { id: "role-family-liaison", sectionId: "role-assignment", cells: { role: "Family Liaison", "assigned-to": "" } },
      { id: "role-ems-greeter", sectionId: "role-assignment", cells: { role: "EMS Greeter / Door Holder", "assigned-to": "" } },
    ],
  },
};

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
export const GLOBAL_TEMPLATES: GlobalDrillTemplate[] = [
  FIRE_EVACUATION,
  LOCKDOWN_SRP,
  SECURE_SRP,
  HOLD_SRP,
  EVACUATE_OFFSITE,
  SHELTER_HAZMAT,
  SEVERE_WEATHER,
  EARTHQUAKE_DCHO,
  REUNIFICATION_SRM,
  BUS_EVACUATION,
  BOMB_THREAT,
  MEDICAL_AED,
];

export function getGlobalTemplate(globalKey: string): GlobalDrillTemplate | undefined {
  return GLOBAL_TEMPLATES.find((t) => t.globalKey === globalKey);
}
