/**
 * Copy for /school-pickup-board. Prices come from the public price table so
 * the page cannot drift from /pricing. No customer names.
 */

import { PUBLIC_PLAN_PRICES } from "~/domain/billing/public-prices";
import { pickSupportedLanguage, type SupportedLanguage } from "~/lib/i18n-config";

export type LandingFaq = { q: string; a: string };

export type LandingCopy = {
  metaTitle: string;
  metaDescription: string;
  kicker: string;
  h1: string;
  subhead: string;
  bookDemo: string;
  startTrial: string;
  problemTitle: string;
  problems: string[];
  howTitle: string;
  steps: { title: string; body: string }[];
  whyTitle: string;
  reasons: { title: string; body: string }[];
  moreTitle: string;
  more: string[];
  pricingTitle: string;
  pricingIntro: string;
  plans: { name: string; price: string; detail: string }[];
  trial: string;
  seePricing: string;
  faqsTitle: string;
  faqs: LandingFaq[];
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

const en: LandingCopy = {
  metaTitle: "School Pickup Board & Dismissal Display | PickupRoster",
  metaDescription:
    "A live, browser-based school pickup board. Staff call cars and every screen updates instantly. No hardware. Free 30-day trial, no card.",
  kicker: "School pickup board",
  h1: "The live school pickup board. Every screen, updated the moment a car is called.",
  subhead:
    "PickupRoster gives your school its own live dismissal board in the browser. Staff call cars from the line, and every classroom, hallway, and staff screen updates instantly. No walkie-talkie chatter. No hardware to buy.",
  bookDemo: "Book a demo",
  startTrial: "Start free trial, no card",
  problemTitle: "Dismissal shouldn't be the loudest, most stressful part of the day.",
  problems: [
    "Names shouted over radios that kids can't hear.",
    "A car line backing up into the neighborhood.",
    "Front-office phones ringing with a last-minute pickup change.",
    "No record of who left with whom.",
  ],
  howTitle: "Call a car. Every board updates.",
  steps: [
    {
      title: "Set up once.",
      body: "Import your roster from PowerSchool, Infinite Campus, Skyward, Blackbaud, or any CSV or XLSX. Give each student a default dismissal plan — car line, walker, bus, after-school program, office pickup, or other — and add recurring exceptions, like a grandparent every Wednesday.",
    },
    {
      title: "Call cars from the line.",
      body: "Staff call students to the pickup zones and lanes you define, from a phone or tablet. Zones can follow grade, exit, or last name. RFID vehicle-tag arrival is an optional add-on on Campus and District plans. It is not required to run the board.",
    },
    {
      title: "Everyone on staff sees it live.",
      body: "The board updates at the same moment on any screen with a browser: classroom displays, hallway TVs, and staff tablets. Car Line includes a teacher and staff viewer. The parent and family viewer app is included on Campus and above.",
    },
  ],
  whyTitle: "Everyone sees the same thing at the same time.",
  reasons: [
    {
      title: "Quiet dismissal.",
      body: "Students watch for their name instead of listening for a radio call.",
    },
    {
      title: "No hardware.",
      body: "It runs in a browser on the screens, tablets, and phones you already own.",
    },
    {
      title: "Your own private board.",
      body: "Each school gets its own address, like yourschool.pickuproster.com. Campus and District plans can use your own domain, such as pickup.yourschool.edu. Schools are never mixed together on one board.",
    },
    {
      title: "Secure viewer access.",
      body: "Viewer PINs and magic links are limited to your school and lock out after failed attempts.",
    },
    {
      title: "Bilingual.",
      body: "English and Spanish are available on every plan.",
    },
  ],
  moreTitle: "More than the car line",
  more: [
    "Fire drills and emergencies: twelve starter drill templates, including fire evacuation, lockdown, and severe weather, with a live roll and an after-action report.",
    "Drill replay on Campus: scrub through every action, with a timestamp and who did it.",
    "Reports and call history on Campus.",
    "Staff roles keep the board locked down. Admins run the school, and the people calling cars are the only ones who can mark the line.",
    "A district dashboard with up to 10 schools included.",
    "Microsoft Entra sign-in is on the way.",
  ],
  pricingTitle: "Simple pricing and a real trial",
  pricingIntro: "Per school. District pricing is custom.",
  plans: [
    {
      name: "Car Line",
      price: `${carMonth}/month or ${carYear}/year`,
      detail: "Up to 400 students. Teacher and staff viewer.",
    },
    {
      name: "Campus",
      price: `${campusMonth}/month or ${campusYear}/year`,
      detail: "Up to 900 students, plus the parent and family viewer app, reports, and drill replay.",
    },
    {
      name: "District",
      price: "Custom",
      detail: "Up to 10 schools included. Additional schools are available as an add-on.",
    },
  ],
  trial:
    "Free trial, no credit card. The trial runs for 30 calendar days from signup. Every new school also gets two free 30-minute intro calls to set up the system and identify anything you need built. If you don't subscribe when the trial ends, the site is suspended and you are not charged. Joining mid-year, or running a small private school? Tell us during the trial and we'll work with you on pricing.",
  seePricing: "See full pricing",
  faqsTitle: "Questions about the school pickup board",
  faqs: [
    {
      q: "What is a school pickup board?",
      a: "A live display showing which students' rides have arrived and where to go, so students head to the right pickup spot without radio calls.",
    },
    {
      q: "Do we need to buy hardware?",
      a: "No. PickupRoster runs in a web browser on screens you already have. Optional RFID vehicle-tag arrival is a custom add-on on Campus and District plans.",
    },
    {
      q: "Can families see the board?",
      a: "Car Line includes a teacher and staff viewer, using a PIN or magic link. The parent and family viewer app is included on Campus and above.",
    },
    {
      q: "How do we get our students in?",
      a: "Import a CSV or XLSX export from PowerSchool, Infinite Campus, Skyward, Blackbaud, or any other student information system. Re-importing updates existing students.",
    },
    {
      q: "Does it handle buses, walkers, and after-school programs?",
      a: "Yes. Each student has a default dismissal plan — car line, walker, bus, after-school, office pickup, or other — and you can set recurring exceptions.",
    },
    {
      q: "Can we use our own domain?",
      a: "On Campus and District plans, yes.",
    },
    {
      q: "What languages are supported?",
      a: "English and Spanish. We add more based on demand.",
    },
    {
      q: "How does the free trial work?",
      a: "No card is required. The trial lasts 30 calendar days, and every new school gets two free 30-minute intro calls. If you don't subscribe, the site is suspended, with no surprise charges.",
    },
    {
      q: "How is student data protected?",
      a: "Viewer access is limited to your school, and our privacy notes explain how pickup records are handled. Read the privacy guide for the details.",
    },
    {
      q: "Can it run our fire drills too?",
      a: "Yes, with drill templates, a live roll, and after-action reports.",
    },
  ],
  finalTitle: "See your dismissal on one live board.",
  finalBody:
    "We'll show you the board, how staff call cars, and how it would fit your school's car line.",
};

const es: LandingCopy = {
  metaTitle: "Tablero de recogida escolar y salida | PickupRoster",
  metaDescription:
    "Un tablero de recogida escolar en vivo, en el navegador. El personal llama a los autos y cada pantalla se actualiza al instante. Sin hardware. Prueba gratis de 30 días, sin tarjeta.",
  kicker: "Tablero de recogida escolar",
  h1: "El tablero de recogida escolar en vivo. Cada pantalla se actualiza en el momento en que se llama un auto.",
  subhead:
    "PickupRoster le da a tu escuela su propio tablero de salida en el navegador. El personal llama a los autos desde la fila, y cada pantalla del salón, el pasillo y el personal se actualiza al instante. Sin radios. Sin hardware que comprar.",
  bookDemo: "Reservar una demo",
  startTrial: "Empieza la prueba gratis, sin tarjeta",
  problemTitle: "La salida no debería ser la parte más ruidosa y estresante del día.",
  problems: [
    "Nombres gritados por radios que los niños no alcanzan a oír.",
    "Una fila de autos que se extiende hasta el vecindario.",
    "El teléfono de la oficina sonando por un cambio de recogida de último minuto.",
    "Sin registro de con quién se fue cada estudiante.",
  ],
  howTitle: "Llama un auto. Todos los tableros se actualizan.",
  steps: [
    {
      title: "Configúralo una vez.",
      body: "Importa tu lista desde PowerSchool, Infinite Campus, Skyward, Blackbaud, o cualquier CSV o XLSX. Asigna a cada estudiante un plan de salida — fila de autos, caminante, autobús, programa después de clases, oficina u otro — y agrega excepciones recurrentes, como un abuelo cada miércoles.",
    },
    {
      title: "Llama a los autos desde la fila.",
      body: "El personal llama a los estudiantes a las zonas y carriles que tú defines, desde un teléfono o una tableta. Las zonas pueden seguir el grado, la salida o el apellido. La llegada con etiqueta RFID es un complemento opcional en los planes Campus y Distrito. No hace falta para usar el tablero.",
    },
    {
      title: "Todo el personal lo ve en vivo.",
      body: "El tablero se actualiza al mismo tiempo en cualquier pantalla con navegador: pantallas de salón, televisores del pasillo y tabletas del personal. Car Line incluye un visor para maestros y personal. La app para familias está incluida desde Campus.",
    },
  ],
  whyTitle: "Todos ven lo mismo al mismo tiempo.",
  reasons: [
    {
      title: "Una salida más tranquila.",
      body: "Los estudiantes buscan su nombre en lugar de escuchar una radio.",
    },
    {
      title: "Sin hardware.",
      body: "Funciona en el navegador, en las pantallas, tabletas y teléfonos que ya tienes.",
    },
    {
      title: "Tu propio tablero privado.",
      body: "Cada escuela tiene su propia dirección, como tuescuela.pickuproster.com. Los planes Campus y Distrito pueden usar tu propio dominio, como recogida.tuescuela.edu. Las escuelas nunca se mezclan en un solo tablero.",
    },
    {
      title: "Acceso de visor seguro.",
      body: "Los PIN y los enlaces mágicos se limitan a tu escuela y se bloquean tras intentos fallidos.",
    },
    {
      title: "Bilingüe.",
      body: "Inglés y español en todos los planes.",
    },
  ],
  moreTitle: "Más que la fila de autos",
  more: [
    "Simulacros y emergencias: doce plantillas iniciales, entre ellas evacuación por incendio, encierro y clima severo, con pase de lista en vivo y un informe posterior.",
    "Repetición del simulacro en Campus: recorre cada acción, con la hora y quién la hizo.",
    "Informes e historial de llamadas en Campus.",
    "Los roles del personal mantienen el tablero cerrado. Los administradores dirigen la escuela, y solo quienes llaman autos pueden marcar la fila.",
    "Un panel de distrito con hasta 10 escuelas incluidas.",
    "El inicio de sesión con Microsoft Entra está en camino.",
  ],
  pricingTitle: "Precios simples y una prueba de verdad",
  pricingIntro: "Por escuela. El precio de Distrito es a medida.",
  plans: [
    {
      name: "Car Line",
      price: `${carMonth}/mes o ${carYear}/año`,
      detail: "Hasta 400 estudiantes. Visor para maestros y personal.",
    },
    {
      name: "Campus",
      price: `${campusMonth}/mes o ${campusYear}/año`,
      detail: "Hasta 900 estudiantes, más la app para familias, informes y repetición de simulacros.",
    },
    {
      name: "District",
      price: "A medida",
      detail: "Hasta 10 escuelas incluidas. Hay escuelas adicionales como complemento.",
    },
  ],
  trial:
    "Prueba gratis, sin tarjeta. Dura 30 días calendario desde el registro. Cada escuela nueva también recibe dos llamadas de introducción gratis de 30 minutos para configurar el sistema y decirnos qué hace falta construir. Si no te suscribes al terminar la prueba, el sitio se suspende y no hay cargos. ¿Te unes a mitad de año, o diriges una escuela privada pequeña? Cuéntanoslo durante la prueba y buscamos un precio contigo.",
  seePricing: "Ver todos los precios",
  faqsTitle: "Preguntas sobre el tablero de recogida escolar",
  faqs: [
    {
      q: "¿Qué es un tablero de recogida escolar?",
      a: "Una pantalla en vivo que muestra qué estudiantes ya tienen su transporte y a dónde ir, para que salgan al punto correcto sin llamadas por radio.",
    },
    {
      q: "¿Hay que comprar hardware?",
      a: "No. PickupRoster funciona en un navegador, en las pantallas que ya tienes. La llegada con etiqueta RFID es un complemento a medida en los planes Campus y Distrito.",
    },
    {
      q: "¿Las familias pueden ver el tablero?",
      a: "Car Line incluye un visor para maestros y personal, con PIN o enlace mágico. La app para familias está incluida desde Campus.",
    },
    {
      q: "¿Cómo cargamos a los estudiantes?",
      a: "Importa un CSV o XLSX de PowerSchool, Infinite Campus, Skyward, Blackbaud u otro sistema. Volver a importar actualiza a los estudiantes que ya existen.",
    },
    {
      q: "¿Sirve para autobuses, caminantes y programas después de clases?",
      a: "Sí. Cada estudiante tiene un plan de salida — fila de autos, caminante, autobús, después de clases, oficina u otro — y puedes definir excepciones recurrentes.",
    },
    {
      q: "¿Podemos usar nuestro propio dominio?",
      a: "En los planes Campus y Distrito, sí.",
    },
    {
      q: "¿Qué idiomas hay?",
      a: "Inglés y español. Agregamos más según la demanda.",
    },
    {
      q: "¿Cómo funciona la prueba gratis?",
      a: "No hace falta tarjeta. La prueba dura 30 días calendario, y cada escuela nueva recibe dos llamadas de introducción gratis de 30 minutos. Si no te suscribes, el sitio se suspende, sin cargos sorpresa.",
    },
    {
      q: "¿Cómo se protegen los datos de los estudiantes?",
      a: "El acceso de visor se limita a tu escuela. La nota de privacidad explica cómo se tratan los registros de recogida.",
    },
    {
      q: "¿También sirve para simulacros de incendio?",
      a: "Sí, con plantillas, pase de lista en vivo e informes posteriores.",
    },
  ],
  finalTitle: "Mira la salida de tu escuela en un solo tablero.",
  finalBody:
    "Te mostramos el tablero, cómo el personal llama a los autos y cómo encajaría en la fila de tu escuela.",
};

const COPY: Record<SupportedLanguage, LandingCopy> = { en, es };

export function schoolPickupBoardCopy(language: string | undefined): LandingCopy {
  return COPY[pickSupportedLanguage(language)];
}
