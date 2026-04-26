// scripts/demo-data/name-pools.ts
//
// Generic, public-domain-style first/last name pools and classroom
// themes used by `generate.ts`. Names were composed by hand to be
// (a) clearly fictional (no real persons), (b) culturally varied, and
// (c) printable in a board screenshot without offending anyone.

export const FIRST_NAMES: readonly string[] = [
  "Aaliyah", "Aiden", "Amara", "Anika", "Arjun", "Asher", "Aurora",
  "Ben", "Beatrix", "Camila", "Caleb", "Carmen", "Chloe", "Daniel",
  "Diego", "Elena", "Eli", "Esme", "Ethan", "Fatima", "Felix",
  "Gabriel", "Greta", "Hana", "Henry", "Ines", "Isaac", "Ivy",
  "Jamal", "Jasmine", "Jaxon", "Jiwoo", "Joelle", "Kai", "Kavya",
  "Kenji", "Kira", "Layla", "Leo", "Liam", "Lina", "Luca", "Maya",
  "Mateo", "Mei", "Mira", "Nadia", "Naya", "Nico", "Noor", "Oliver",
  "Olivia", "Omar", "Pablo", "Penelope", "Priya", "Quinn", "Rafael",
  "Riya", "Rosa", "Sage", "Sami", "Sana", "Santiago", "Sienna",
  "Sofia", "Tahir", "Theo", "Uma", "Valentina", "Wren", "Xavier",
  "Yasmin", "Yusuf", "Zara", "Zion",
];

export const LAST_NAMES: readonly string[] = [
  "Abara", "Adler", "Aguilar", "Akhtar", "Andrade", "Banerjee",
  "Brennan", "Bui", "Calderon", "Campbell", "Chang", "Chen",
  "Cisneros", "Cohen", "Dang", "Diaz", "Doyle", "Dubois", "Edwards",
  "Eze", "Faber", "Fischer", "Foster", "Garcia", "Goh", "Greene",
  "Gupta", "Haddad", "Hassan", "Holt", "Hwang", "Iglesias", "Imani",
  "Iqbal", "Jacobs", "Jain", "Joseph", "Kapoor", "Kato", "Khalil",
  "Kim", "Kirk", "Kovac", "Lal", "Lee", "Lopez", "Madsen", "Mahmoud",
  "Mejia", "Mendoza", "Mwangi", "Nakamura", "Navarro", "Nguyen",
  "Okafor", "Orsini", "Park", "Patel", "Pham", "Pierce", "Quintana",
  "Rahman", "Ramirez", "Reyes", "Rivera", "Saito", "Salazar",
  "Santos", "Shah", "Silva", "Singh", "Sokolov", "Tanaka", "Torres",
  "Ueda", "Vargas", "Vega", "Wang", "Webb", "Williams", "Xu",
  "Yamamoto", "Zhao",
];

/**
 * Teacher last-name pool. Disjoint from LAST_NAMES so there's no overlap
 * between a student's family name and a classroom's homeroom name in the
 * demo. Helpful when demoing the “sibling” feature.
 */
export const TEACHER_LAST_NAMES: readonly string[] = [
  "Atwood", "Bishop", "Carlisle", "Delgado", "Espinoza", "Forrest",
  "Greer", "Hsu", "Iverson", "Jansen", "Kowalski", "Lambert",
  "Martins", "Nakashima", "Okonkwo", "Pereira", "Quinn", "Rasmussen",
  "Soriano", "Talbot", "Underwood", "Voss", "Whitfield", "Yates",
];

export const PROGRAM_NAMES: readonly string[] = [
  "After-School Care",
  "Robotics Club",
  "Drama Club",
  "Chess Club",
  "Soccer (Intramural)",
  "Choir",
  "Math Olympiad",
  "Art Studio",
  "Coding Club",
];
