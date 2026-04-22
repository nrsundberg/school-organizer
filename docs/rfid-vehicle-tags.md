# RFID vehicle tags for automatic pickup arrival

Exploratory product brief. Not yet committed to the roadmap. Sized for a pilot with Tiome and similar customers who run a batch-release pickup model.

## The idea in one paragraph

Parents stick a passive UHF RFID tag on the inside of their windshield (mirror hang tag or printable sticker). When they drive into the pickup lane, a reader at the entrance picks up the tag's unique ID and our backend auto-advances that family's queue state from "Not here" → "In queue." For organizations that want it, the controller is still the one who taps "Ready" (per-car or per-batch); for others we can auto-advance all the way to "Ready" on read. Dashboards update in real time and controllers get a live "who's here vs. who we're still waiting on" view — which is the actually-new capability, not just automation of the tap.

## Why passive UHF (vs. BLE, LPR, NFC)

Passive UHF RFID (RAIN RFID, the same family of chips used in toll tags and hotel parking access) is the right call for this use case. No batteries in the tag, read range of 10–30 ft through a windshield, tags cost a few dollars each, one reader covers a whole lane. BLE/phone-app is cheaper to start but less reliable (app has to be running, phone has to be unlocked on some platforms, Bluetooth has to be on). License plate recognition removes the tag but adds a camera-quality problem and worse privacy optics. NFC is too short-range (inches). Active RFID with batteries is overkill and costs 10x more per tag.

## Suppliers we'd actually use

Three layers: the tag (on the car), the reader + antenna (on the pickup lane), and the software that writes/manages tag IDs.

### Tags

- **[atlasRFIDstore](https://www.atlasrfidstore.com/rfid-vehicle-tags/)** — US-based distributor, fastest path for small-volume starter kits. Their Vulcan RFID Custom Windshield Tag and Onsite Printable Windshield Tag are both purpose-built for this use case (tamper-evident backing, read through glass).
- **[Avery Dennison UHF inlays via atlasRFIDstore](https://www.atlasrfidstore.com/uhf-rfid-tags-inlays-avery-dennison/)** — cheaper raw inlays if we want to source white-label "Pickup Roster" branded tags at scale.
- **[GAO RFID](https://gaorfid.com/devices/readers-by-feature/long-range-rfid-readers/)** — enterprise/commercial supplier, useful when a district wants a single vendor for both tags and readers on paper.

Real retail pricing, April 2026: [vehicle tags typically run $2–$15 each](https://rfidtag.com/rfid-tag-price/) at low volume, with bulk orders (10,000+) [dropping 40–60%](https://www.atlasrfidstore.com/rfid-tags/) into the $1.00–$2.50 range. For a Tiome-sized campus (say 300 families, give each family 2 tags for a primary + secondary car) we're at 600 tags, which puts us in a midrange bracket of roughly $2–$4 per tag landed.

### Readers + antennas

Two tiers depending on customer budget.

- **Enterprise reader** — [Impinj Speedway R420](https://www.atlasrfidstore.com/impinj-speedway-revolution-r420-uhf-rfid-reader-4-port/) (or its successor the R700). 4-port fixed reader, the industry standard. Retail $1,730–$2,185 plus $150–$400 per antenna plus cabling and mounting. You'd want one reader and one antenna per pickup lane. This is what we'd install at a district that wants the "real" deployment.
- **Integrated all-in-one** — [Yanzeo SR682 / SR791 / SI801](https://www.yanzeo.com/rfid-write-reader/fixed-rfid-readers/yanzeo-si801-15-30m-long-range-uhf-rfid-reader-ip67-rs232-485-wiegand-12dbi-antenna-uhf-integrated-reader.html) or [VENREA SR682](https://www.amazon.com/VENREA-Network-Integrated-Parking-Library/dp/B0CS9PCHWM). Reader and antenna in one IP67 outdoor housing, 3–15m read range, Ethernet/RS485/Wiegand output, $200–$600 retail on Amazon. Good enough for a single lane at a single school. This is what Tiome would install.

A small edge device (Raspberry Pi class, $75) reads from the reader over Ethernet, debounces and dwell-filters the stream, and POSTs to our API. That's the piece we write and ship.

### How tags are programmed

The relevant part of a UHF Gen 2 tag is the **EPC memory bank** — [a 96-bit identifier that's the primary thing any reader returns](https://www.atlasrfidstore.com/rfid-insider/encoding-rfid-tags-3-things-to-know/). Two realistic approaches:

1. **Use the factory-burned TID as the key.** Every tag ships with a unique, unalterable TID (tag ID) from the manufacturer. We can read it and use it as our identifier without writing anything. Simplest, no encoding step, but the ID is opaque to humans and we have to associate it with a family at enrollment.
2. **Write our own EPC.** Encode a structured ID like `PKRS-<orgId>-<familyId>-<tagSeq>` (in hex, since [over 97% of users use hex encoding](https://www.atlasrfidstore.com/rfid-insider/encoding-rfid-tags-3-things-to-know/)). Lets us print human-readable labels, rotate tags if compromised, and decode directly from the read without a DB lookup (useful fallback if the network is down).

For writing, we have three paths:

- **Desktop tool**: [Zebra 123RFID Desktop](https://supportcommunity.zebra.com/s/article/000020705?language=en_US) or atlasRFIDstore's Vulcan Encoder — plug in a USB desktop reader, batch-encode tags from a CSV. Good for pre-shipping kits to schools.
- **Handheld encoder**: Zebra RFD8500 or similar handheld — school admin encodes tags on-site as families enroll. ~$1,800 per unit.
- **Programmatic**: Our own thin web app over the reader API (Impinj has [a documented API](https://www.zebra.com/content/dam/support-dam/en/documentation/unrestricted/guide/software/rfid3-pg-en.pdf)), so an admin can write new tags from Pickup Roster itself. Longer build, nicer experience.

For the pilot, approach #1 (use the factory TID) is the fastest to ship. We can layer #2 on later when we want branded kits.

## Lost-tag blocking — how easy?

Very easy. The tag's ID (whether it's the factory TID or our-written EPC) is just a row in our database with a foreign key to a family. Blocking a tag is one flag:

```
Tag { id, epc, familyId, status: ACTIVE | LOST | RETIRED, revokedAt }
```

When a reader sends us an EPC, we look it up:
- `ACTIVE` → advance the family's queue state as configured.
- `LOST` or `RETIRED` → ignore the read, log it, and optionally alert the controller ("an inactive tag was just read at Gate 1 — possibly a lost tag in use").

The physical tag keeps emitting its ID forever (no way to "brick" a passive RFID tag remotely, same as you can't brick a toll tag without crushing it) — but our software simply doesn't trust it. The parent-facing flow is a one-click "Report lost tag" button in the family app that flips the status to `LOST` in real time. We then ship a replacement tag with a new EPC. If the "lost" tag turns up later, the parent can reactivate it from the same screen, or we leave it retired.

Practical notes:
- Because the signal is one-way (the tag doesn't know we've revoked it), the block is purely server-side — meaning the revocation takes effect the instant the flag is flipped. No need to push anything to readers, no propagation delay.
- If a school is using the offline-fallback mode (reader-level allowlist for when the internet is down), the revocation has to also push to each reader. We'd sync that allowlist on reconnect. For MVP we can skip offline mode and require internet.
- Log all reads — including ignored ones — so controllers and admins can spot misuse.

## What we'd charge

This is the part most worth debating. A few ways to structure it:

**Option A: Software fee only, customer sources hardware.** We charge a per-school RFID module fee (say $75–$150/mo on top of Campus/District pricing) and publish a "recommended hardware" list with affiliate or partner pricing. Customer buys and installs tags + reader themselves (or uses their AV vendor). Lowest friction for us, lowest ACV uplift.

**Option B: Software fee + tag pass-through.** Same software fee, plus we sell branded tags at cost + small margin (say $5/tag retail, cost to us ~$2.50). Customer still sources readers. Sticky — we become the tag vendor of record.

**Option C: Turnkey bundle.** We package reader + antenna + edge device + tags + software + install support and charge a one-time install fee ($3,000–$6,000 per lane) plus the recurring software fee. Biggest ACV bump, biggest operational burden — we're now running logistics.

Ballpark for a Tiome-style pilot (single campus, single lane, 300 families, 600 tags, integrated reader): hardware cost to us is roughly $600 reader + $75 edge device + $1,500 tags = **~$2,200 landed**, before install labor. At a 2x gain factor and a $100/mo recurring fee, that's a 12-month payback on the install and steady margin after.

My recommendation for v1: **Option A with a path to Option C for districts.** We ship the software, bless a hardware partner (atlasRFIDstore can drop-ship both tags and a Yanzeo/VENREA reader), and write a one-page install guide. For districts that don't want to touch hardware, we quote a turnkey bundle as a separate line item.

Pricing framing on the site: "RFID vehicle-tag integration is available as a custom add-on to Campus and District plans. Hardware sourcing varies by deployment — we'll scope it with you."

## Data model sketch

Additions to the schema roughly look like:

```
Vehicle {
  id
  familyId          (FK → Family)
  label             ("Mom's Subaru")
  active
}

Tag {
  id
  epc               (unique, indexed)
  vehicleId         (FK → Vehicle, nullable — tags can exist unassigned)
  status            (ACTIVE | LOST | RETIRED)
  issuedAt
  revokedAt
}

Reader {
  id
  orgId             (FK → Org)
  campusId          (FK → Campus)
  label             ("Main gate")
  zone              (ARRIVAL | PARKED | EXIT)
  lastSeenAt
}

TagRead {
  id
  readerId
  epc
  readAt
  rssi
  resolvedFamilyId  (nullable — null if EPC didn't match an active tag)
  action            (ADVANCED_QUEUE | IGNORED_INACTIVE | IGNORED_DUPLICATE | ALERT)
}
```

The existing pickup queue state machine doesn't change; we just add "RFID read at zone X" as a new trigger that, per org settings, can advance state.

## Org settings we need

- Enable RFID module (on/off)
- Per-zone behavior: on read, advance to `IN_QUEUE` | advance to `READY` | no-op (just log for dashboard)
- Dwell threshold (seconds) — ignore re-reads of the same tag within N seconds to avoid double-counting
- Re-read suppression window — after a family has been marked `GONE`, ignore further reads for the rest of the pickup window
- Offline-tolerant mode (future) — allow readers to keep working during internet outages

## Pilot plan with Tiome

1. Inventory current workflow with Tiome — confirm the "50 cars in, all park, controller marks all" model end-to-end.
2. Install one Yanzeo SR682 or VENREA SR682 at the pickup lane entrance. Edge device on school WiFi.
3. Ship 600 tags (2 per family, factory-TID-keyed for v1). Use an on-site encoding session during one pickup week to associate tags to families (scan tag → pull up family → confirm).
4. Ship Tiome a new "Expected vs. arrived" dashboard widget that updates in real time from reads.
5. Keep the existing "mark 50 as here" button in place — don't replace the workflow, just give the controller better information feeding into that decision.
6. Measure: do arrivals get logged accurately? How many reads are missed or spurious? What's the controller's qualitative reaction?
7. Decide whether to graduate to per-car auto-advance for the schools that want it.

## Open questions

- Carpools: one student, multiple families' tags authorized to pick up on rotating days. Do we let all authorized vehicles advance the queue, or require today's driver to be pre-declared in the app?
- Tag placement: windshield tags read best, but some parents will object to sticking them on. Do we offer a glove-box card or visor clip as alternative (slightly worse range, needs to be pulled out)?
- What happens when a second car arrives while the first is still being processed? Per-car vs. per-family queue state.
- Do we want to eventually read tags again at an exit point to auto-mark `GONE`?
- Security: tags can be cloned with ~$500 of equipment. Is the threat model a concern here? Probably not at a school, but worth documenting.

## Recommendation

Build Option A as a District-tier and Campus-tier add-on. Pilot with Tiome on a handshake scope of work. Software side is ~2 weeks of backend work (schema, read ingest endpoint, settings, dashboard widget, lost-tag flow), hardware side is an afternoon of cable-pulling at the customer's site. Price the software add-on at $100/mo per campus and don't try to be the hardware vendor until we've done 3–5 installs and understand the logistics properly.
