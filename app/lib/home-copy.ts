/**
 * Long-form copy for the marketing home page. Prices come from the public
 * price table. No customer names. The Maryland sentence is a stated fact.
 */

import { ANNUAL_DISCOUNT_PERCENT, PUBLIC_PLAN_PRICES } from "~/domain/billing/public-prices";
import { pickSupportedLanguage, type SupportedLanguage } from "~/lib/i18n-config";

export type HomeFaq = { q: string; a: string };
export type HomeRead = { href: string; title: string; note: string };

export type HomeCopy = {
  kicker: string;
  h1: string;
  lede: string;
  startTrial: string;
  bookDemo: string;
  viewPricing: string;
  problemTitle: string;
  problem: string[];
  howTitle: string;
  howLede: string;
  steps: { title: string; body: string }[];
  featuresTitle: string;
  featuresLede: string;
  features: { title: string; body: string }[];
  whoTitle: string;
  who: string[];
  pricingTitle: string;
  pricing: string[];
  seePricing: string;
  seeBoard: string;
  readingTitle: string;
  readingLede: string;
  reads: HomeRead[];
  faqsTitle: string;
  faqsLede: string;
  seeFaqs: string;
  faqs: HomeFaq[];
  finalTitle: string;
  finalBody: string;
};

function money(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

const carMonth = money(PUBLIC_PLAN_PRICES.CAR_LINE.monthlyDollars);
const carYear = money(PUBLIC_PLAN_PRICES.CAR_LINE.annualDollars);
const campusMonth = money(PUBLIC_PLAN_PRICES.CAMPUS.monthlyDollars);
const campusYear = money(PUBLIC_PLAN_PRICES.CAMPUS.annualDollars);
const save = String(ANNUAL_DISCOUNT_PERCENT);

const readsEn: HomeRead[] = [
  {
    href: "/guides/configuring-pickup-zones-and-lane-assignments",
    title: "Set up pickup zones and lanes",
    note: "Map the curb before the first dismissal.",
  },
  {
    href: "/guides/importing-student-rosters-from-sis",
    title: "Import a student roster",
    note: "Bring students in from the system you already use.",
  },
  {
    href: "/guides/setting-up-your-first-drill-template",
    title: "Set up your first drill",
    note: "Start a fire drill from a template.",
  },
  {
    href: "/blog/diagnose-car-line-wait-times-before-the-first-bell",
    title: "Diagnose car-line wait times",
    note: "What to watch before you change the plan.",
  },
  {
    href: "/blog/from-clipboards-to-carlines-digital-transition-guide",
    title: "From clipboards to a live board",
    note: "Leave the paper list behind.",
  },
];

const readsEs: HomeRead[] = [
  {
    href: "/guides/configuring-pickup-zones-and-lane-assignments",
    title: "Configura zonas y carriles",
    note: "Ordena la banqueta antes de la primera salida.",
  },
  {
    href: "/guides/importing-student-rosters-from-sis",
    title: "Importa la lista de estudiantes",
    note: "Trae a los estudiantes desde el sistema que ya usas.",
  },
  {
    href: "/guides/setting-up-your-first-drill-template",
    title: "Configura tu primer simulacro",
    note: "Empieza un simulacro de incendio desde una plantilla.",
  },
  {
    href: "/blog/diagnose-car-line-wait-times-before-the-first-bell",
    title: "Diagnostica los tiempos de espera",
    note: "Qué mirar antes de cambiar el plan.",
  },
  {
    href: "/blog/from-clipboards-to-carlines-digital-transition-guide",
    title: "De las listas en papel al tablero en vivo",
    note: "Deja el portapapeles.",
  },
];

const en: HomeCopy = {
  kicker: "School pickup and car line",
  h1: "A live school pickup board for your car line.",
  lede:
    "PickupRoster gives each school a live pickup board. Staff call cars from the line, and every screen updates at the same moment. No radios, and no hardware to buy.",
  startTrial: "Start free trial",
  bookDemo: "Book a demo",
  viewPricing: "View pricing",
  problemTitle: "The car line gets loud before it gets organized.",
  problem: [
    "The last bell is when a normal afternoon turns into a traffic problem. Cars stack up at the curb. A name goes out on a walkie-talkie that half the building cannot hear.",
    "A school pickup board replaces that scramble with one shared picture. The person at the curb calls the car. The name shows on the screens the school already owns. Teachers send students when they see the name. The office watches the same list from the desk.",
  ],
  howTitle: "How dismissal works on the board",
  howLede:
    "Three moves cover an ordinary afternoon.",
  steps: [
    {
      title: "Staff call a car.",
      body: "The person running the line calls a student from a phone or a tablet. You set the zones and lanes by grade, by exit, or by last name. Admins run the school. The people calling cars are the only ones who mark the line.",
    },
    {
      title: "Every screen updates instantly.",
      body: "Classroom displays, a hallway TV, and a tablet at the other door show the same names at the same moment. If the screen has a browser, it can show the board.",
    },
    {
      title: "Teachers see it. Families can, too.",
      body: "Car Line includes a teacher and staff viewer. Share a PIN or a magic link, and it locks after failed attempts. The parent and family viewer is included on Campus and above, so families can follow the line instead of calling the office.",
    },
  ],
  featuresTitle: "What a school actually gets",
  featuresLede:
    "The board is the daily tool. Drills and last-minute changes live in the same place.",
  features: [
    {
      title: "A live board on any screen.",
      body: "Open it on the lobby display, the tablet at the curb, or the computer in the classroom.",
    },
    {
      title: "A car line you can run from the curb.",
      body: "Call a car, hold a lane, and keep the next name visible without repeating it over a radio.",
    },
    {
      title: "Fire drills, and drill replay on Campus.",
      body: "Start from a drill template and take a live roll. Campus adds replay so you can review what happened.",
    },
    {
      title: "Viewer PINs and magic links.",
      body: "Access stays limited to your school. You choose who gets a PIN or a link.",
    },
    {
      title: "English and Spanish.",
      body: "Both languages are included on every plan.",
    },
    {
      title: "No hardware to buy.",
      body: "It runs in the browser on the screens, tablets, and phones you already have.",
    },
  ],
  whoTitle: "Who it is for",
  who: [
    "PickupRoster is for principals, assistant principals, and the front office. It fits one school that wants a calmer car line, and a district that wants each campus on its own board. Schools are never mixed together.",
    "A K-12 school in Maryland has run dismissal on PickupRoster for over two years. Admins run the school. Teachers watch for names. The people at the curb call the cars. Families, on Campus and above, can watch the line instead of phoning the office.",
  ],
  pricingTitle: "Pricing, and a trial that does not ask for a card",
  pricing: [
    `Car Line starts at ${carMonth} a month, or ${carYear} a year. Campus is ${campusMonth} a month, or ${campusYear} a year. Annual billing is ${save}% off. District pricing is custom, and it is the plan for a group of schools.`,
    "The free trial lasts 30 calendar days. No credit card is required. Every new school also gets two free 30-minute intro calls. If you do not subscribe, the site is suspended and you are not charged.",
    "Car Line is the start for a school that wants the live board and a teacher and staff viewer. Campus adds the parent and family viewer, reports, and drill replay.",
  ],
  seePricing: "See pricing",
  seeBoard: "Read about the school pickup board",
  readingTitle: "Guides and notes for the people running dismissal",
  readingLede: "Pages for administrators setting up a car line or a first drill.",
  reads: readsEn,
  faqsTitle: "Questions administrators ask first",
  faqsLede: "Short answers. The full list lives on the FAQ page.",
  seeFaqs: "See all FAQs",
  faqs: [
    {
      q: "What is a school pickup board?",
      a: "A live display of which students have been called and where they should go, so they leave when they see their name.",
    },
    {
      q: "Do we need to buy hardware?",
      a: "No. PickupRoster runs in a web browser on the screens, tablets, and phones the school already has.",
    },
    {
      q: "Can families see the board?",
      a: "Car Line includes a teacher and staff viewer, using a PIN or a magic link. The parent and family viewer is included on Campus and above.",
    },
    {
      q: "How does the free trial work?",
      a: "It lasts 30 calendar days, and no card is required. Every new school also gets two free 30-minute intro calls. If you do not subscribe, the site is suspended and you are not charged.",
    },
    {
      q: "Can the same board run a fire drill?",
      a: "Yes. You get starter drill templates and a live roll. Campus adds drill replay so you can review what happened.",
    },
  ],
  finalTitle: "See your car line on one board.",
  finalBody:
    "Book a short demo, or start the 30-day trial and call the first cars yourself. No card is required to begin.",
};

const es: HomeCopy = {
  kicker: "Recogida escolar y fila de autos",
  h1: "Un tablero de recogida escolar en vivo para tu fila de autos.",
  lede:
    "PickupRoster le da a cada escuela un tablero de recogida en vivo. El personal llama a los autos desde la fila y cada pantalla se actualiza al mismo tiempo. Sin radios y sin hardware que comprar.",
  startTrial: "Comenzar prueba gratuita",
  bookDemo: "Reservar una demo",
  viewPricing: "Ver precios",
  problemTitle: "La fila de autos se vuelve ruidosa antes de ordenarse.",
  problem: [
    "El último timbre es cuando una tarde normal se convierte en un problema de tráfico. Los autos se amontonan en la banqueta. Un nombre sale por un radio que la mitad del edificio no alcanza a oír.",
    "Un tablero de recogida escolar cambia ese ruido por una sola imagen compartida. Quien está en la banqueta llama el auto. El nombre aparece en las pantallas que la escuela ya tiene. Los maestros envían a los estudiantes cuando ven el nombre. La oficina mira la misma lista desde el escritorio.",
  ],
  howTitle: "Cómo funciona la salida en el tablero",
  howLede: "Tres pasos cubren una tarde normal.",
  steps: [
    {
      title: "El personal llama un auto.",
      body: "Quien dirige la fila llama a un estudiante desde un teléfono o una tableta. Tú defines las zonas y los carriles por grado, por salida o por apellido. Los administradores dirigen la escuela. Solo quienes llaman autos marcan la fila.",
    },
    {
      title: "Cada pantalla se actualiza al instante.",
      body: "Las pantallas del salón, un televisor del pasillo y una tableta en la otra puerta muestran los mismos nombres al mismo tiempo. Si la pantalla tiene un navegador, puede mostrar el tablero.",
    },
    {
      title: "Los maestros lo ven. Las familias también pueden.",
      body: "Car Line incluye un visor para maestros y personal. Comparte un PIN o un enlace mágico, y se bloquea tras intentos fallidos. El visor para familias está incluido desde Campus, para que sigan la fila en lugar de llamar a la oficina.",
    },
  ],
  featuresTitle: "Lo que recibe una escuela",
  featuresLede: "El tablero es la herramienta de cada día. Los simulacros y los cambios de último minuto viven en el mismo lugar.",
  features: [
    {
      title: "Un tablero en vivo en cualquier pantalla.",
      body: "Ábrelo en la pantalla del vestíbulo, en la tableta de la banqueta o en la computadora del salón.",
    },
    {
      title: "Una fila de autos que se dirige desde la banqueta.",
      body: "Llama un auto, sostén un carril y deja el siguiente nombre a la vista sin repetirlo por radio.",
    },
    {
      title: "Simulacros de incendio y repetición en Campus.",
      body: "Empieza con una plantilla y haz el pase de lista en vivo. Campus agrega la repetición para revisar lo que pasó.",
    },
    {
      title: "PIN de visor y enlaces mágicos.",
      body: "El acceso se limita a tu escuela. Tú eliges quién recibe un PIN o un enlace.",
    },
    {
      title: "Inglés y español.",
      body: "Los dos idiomas están incluidos en todos los planes.",
    },
    {
      title: "Sin hardware que comprar.",
      body: "Funciona en el navegador, en las pantallas, tabletas y teléfonos que ya tienes.",
    },
  ],
  whoTitle: "Para quién es",
  who: [
    "PickupRoster es para directores, subdirectores y la oficina. Sirve para una escuela que quiere una fila más tranquila y para un distrito que quiere cada campus en su propio tablero. Las escuelas nunca se mezclan.",
    "Una escuela K-12 en Maryland lleva más de dos años la salida con PickupRoster. Los administradores dirigen la escuela. Los maestros buscan nombres. Quienes están en la banqueta llaman los autos. Las familias, desde Campus, pueden mirar la fila en lugar de llamar a la oficina.",
  ],
  pricingTitle: "Precios y una prueba que no pide tarjeta",
  pricing: [
    `Car Line empieza en ${carMonth} al mes, o ${carYear} al año. Campus cuesta ${campusMonth} al mes, o ${campusYear} al año. El pago anual tiene ${save}% de descuento. El precio de Distrito es a medida, y es el plan para un grupo de escuelas.`,
    "La prueba gratis dura 30 días calendario. No se requiere tarjeta. Cada escuela nueva también recibe dos llamadas de introducción gratis de 30 minutos. Si no te suscribes, el sitio se suspende y no hay cargos.",
    "Car Line es el inicio para una escuela que quiere el tablero en vivo y un visor para maestros y personal. Campus agrega el visor para familias, informes y la repetición de simulacros.",
  ],
  seePricing: "Ver precios",
  seeBoard: "Leer sobre el tablero de recogida escolar",
  readingTitle: "Guías y notas para quienes dirigen la salida",
  readingLede: "Páginas para administradores que arman una fila de autos o un primer simulacro.",
  reads: readsEs,
  faqsTitle: "Preguntas que hacen primero los administradores",
  faqsLede: "Respuestas cortas. La lista completa está en la página de preguntas frecuentes.",
  seeFaqs: "Ver todas las preguntas",
  faqs: [
    {
      q: "¿Qué es un tablero de recogida escolar?",
      a: "Una pantalla en vivo de qué estudiantes ya fueron llamados y a dónde deben ir. Salen cuando ven su nombre, en lugar de esperar una llamada por radio.",
    },
    {
      q: "¿Hay que comprar hardware?",
      a: "No. PickupRoster funciona en un navegador, en las pantallas, tabletas y teléfonos que la escuela ya tiene.",
    },
    {
      q: "¿Las familias pueden ver el tablero?",
      a: "Car Line incluye un visor para maestros y personal, con un PIN o un enlace mágico. El visor para familias está incluido desde Campus.",
    },
    {
      q: "¿Cómo funciona la prueba gratis?",
      a: "Dura 30 días calendario y no hace falta tarjeta. Cada escuela nueva también recibe dos llamadas de introducción gratis de 30 minutos. Si no te suscribes, el sitio se suspende y no hay cargos.",
    },
    {
      q: "¿El mismo tablero sirve para un simulacro de incendio?",
      a: "Sí. Hay plantillas iniciales y un pase de lista en vivo. Campus agrega la repetición del simulacro para revisar lo que pasó.",
    },
  ],
  finalTitle: "Mira tu fila de autos en un solo tablero.",
  finalBody:
    "Reserva una demo corta, o empieza la prueba de 30 días y llama los primeros autos tú mismo. No hace falta tarjeta para comenzar.",
};

const COPY: Record<SupportedLanguage, HomeCopy> = { en, es };

export function homeCopy(language: string | undefined): HomeCopy {
  return COPY[pickSupportedLanguage(language)];
}

/** Visible words in the English or Spanish home copy, excluding link paths. */
export function homeCopyWordCount(language: string | undefined): number {
  const copy = homeCopy(language);
  const bits: string[] = [
    copy.kicker,
    copy.h1,
    copy.lede,
    copy.startTrial,
    copy.bookDemo,
    copy.viewPricing,
    copy.problemTitle,
    ...copy.problem,
    copy.howTitle,
    copy.howLede,
    ...copy.steps.flatMap((step) => [step.title, step.body]),
    copy.featuresTitle,
    copy.featuresLede,
    ...copy.features.flatMap((feature) => [feature.title, feature.body]),
    copy.whoTitle,
    ...copy.who,
    copy.pricingTitle,
    ...copy.pricing,
    copy.seePricing,
    copy.seeBoard,
    copy.readingTitle,
    copy.readingLede,
    ...copy.reads.flatMap((item) => [item.title, item.note]),
    copy.faqsTitle,
    copy.faqsLede,
    copy.seeFaqs,
    ...copy.faqs.flatMap((item) => [item.q, item.a]),
    copy.finalTitle,
    copy.finalBody,
  ];
  return bits.join(" ").split(/\s+/).filter(Boolean).length;
}
