type StudentName = {
  firstName: string;
  lastName: string;
};

export function studentDisplayName(student: StudentName): string {
  return `${student.firstName} ${student.lastName}`.trim();
}

export function parseStudentIds(formData: FormData): number[] {
  return formData
    .getAll("studentIds")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

export function defaultHouseholdName(students: StudentName[]): string {
  if (students.length === 0) return "New household";
  const lastNames = Array.from(
    new Set(students.map((student) => student.lastName.trim()).filter(Boolean)),
  );
  if (lastNames.length === 1) return `${lastNames[0]} household`;
  return `${studentDisplayName(students[0])} household`;
}
