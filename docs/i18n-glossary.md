# i18n glossary — Spanish (Latin American)

This is the canonical translation glossary used across all `public/locales/es/*.json`
files. Translators (human or otherwise) should reuse these mappings to stay
consistent across the product.

Variant: **neutral Latin American Spanish** (Mexican / Central American
families are the primary audience). Avoid Castilian-specific vocabulary
(no "ordenador", no "vosotros", etc.).

Tone: warm, parent-friendly, professional — roughly the register of a school
newsletter. Use "tú" in casual UI to staff/parents; switch to "usted" only
when the original is unambiguously formal.

## Core school-domain terms

| English | Spanish | Notes |
| --- | --- | --- |
| pickup (act of picking kids up) | recogida | "salida" can also work for end-of-day |
| dismissal | salida | "salida escolar" when ambiguous |
| drop-off | entrega | morning drop-off |
| homeroom | salón principal | "aula" also acceptable; "homeroom" doesn't have a tidy equivalent |
| fire drill | simulacro de incendio | |
| drill (emergency) | simulacro | |
| lockdown drill | simulacro de encierro | |
| shelter-in-place | refugio en el lugar | |
| reunification | reunificación | |
| household | hogar | "familia" used when softer tone fits |
| roster | lista (de estudiantes) / registro | "lista" for the student roster, "registro" when it's a logged record |
| caller (person calling kids) | anunciador | also "persona que llama"; pick whichever reads naturally in the sentence |
| car line | fila de autos / línea de recogida | use "fila de autos" most often; "línea de recogida" reads well in marketing |
| parking space (for pickup) | espacio de estacionamiento | abbreviated as "espacio" when context is clear |
| viewer (read-only role) | observador | for the user/role |
| controller (active operator role) | controlador | |
| admin (role) | administrador | |
| school | escuela | "colegio" is also fine; "escuela" is more common in LatAm |
| classroom | aula / salón de clases | |
| student | estudiante / alumno | "estudiante" preferred — gender-neutral |
| family | familia | |
| sibling group | grupo de hermanos | |
| after-school program | programa extraescolar | |
| cancellation notice | aviso de cancelación | |
| board (live display) | tablero | |
| live board | tablero en vivo | |
| trial (free SaaS trial) | prueba gratuita | |
| trial (qualifying day) | día de prueba válido | |
| checkout (Stripe) | pago | Stripe localizes its own UI; we just refer to "pago" |
| invoice | factura | |
| past due | vencido | |
| suspended | suspendido | |
| comped | cortesía | "cuenta de cortesía" reads naturally |
| onboarding | incorporación | |
| sign in / log in | iniciar sesión | |
| sign up | registrarse / crear cuenta | "Crear cuenta" works well as a CTA |
| sign out / log out | cerrar sesión | |
| magic link | enlace mágico | |
| PIN / access code | código de acceso | |
| support | soporte | |
| save | guardar | |
| cancel | cancelar | |
| continue | continuar | |
| back | atrás / volver | |
| edit | editar | |
| delete | eliminar | |
| ban / unban (user) | suspender / reactivar | "suspender" was already used for org status — context disambiguates |
| revoke | revocar | |
| impersonate | suplantar | |

## Product / brand names — never translate

- Pickup Roster / PickupRoster
- Stripe
- Cloudflare
- Anthropic
- Microsoft Entra
- WebSocket
- RFID
- NFPA, SRP, FEMA, NWS (safety standards)

## Plural-key handling

Spanish has the same `_one` / `_other` distinction as English. For a key like
`students_one` / `students_other`, translate both forms — "1 estudiante" /
"{{count}} estudiantes".

## Interpolation

Always preserve `{{var}}` exactly. Translate only the surrounding prose.
Examples:
- `"Space {{spaceNumber}} is empty"` → `"El espacio {{spaceNumber}} está vacío"`
- `"{{count}} student"` / `"{{count}} students"` → `"{{count}} estudiante"` / `"{{count}} estudiantes"`

## Items flagged for human/native-speaker review (TODO)

- "caller" — the person calling out kid names at pickup. We use **"anunciador"**
  but a native speaker may prefer "llamador" or simply rephrasing. No perfect
  one-word match.
- "homeroom" — no clean Spanish equivalent. We use **"salón principal"** but
  some Latin American schools say "aula asignada" or just "salón". Worth a
  check from a Mexican/Central American school admin.
- "car line" / "car space" — translated as **"fila de autos"** / **"espacio
  de estacionamiento"** but in some regions parents say "fila de carros". The
  app already uses "Car Line" as a product name in the pricing tier — that
  stays English.
- "Drill" toasts and confirmation copy — review for register; the English is
  fairly informal ("End this drill?") and we kept that.
- "Comped account" — translated as **"cuenta de cortesía"** which is a real
  expression but uncommon; some teams say "sin costo" or "cuenta gratuita".
- The blog/marketing prose ("Field notes from the car line", "Get structured
  dismissal up and running in a week.") is voice-y English — we made
  reasonable adaptations rather than literal translations. A copywriter
  should re-read these.
- Email body copy is intentionally casual ("how's pickup going?") and signed
  by Noah — translations preserve the casual tone but a native speaker
  should verify nothing reads stilted.

## Items intentionally left in English

- Brand and proper nouns (see list above).
- The string `"---"` (display placeholder, not language-dependent).
- Color hex format example strings (`#1A2B3C`).
- The dash `"—"` and similar punctuation-only values.
- `"YYYY-MM-DD"` style format strings (none found in this pass, but the rule
  stands).
