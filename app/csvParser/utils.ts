export const headerBody = (
  fileString: string
): { header: string[]; body: Array<string[]> } => {
  const splitout = fileString.split("\n").map((it) => it.trim());
  const header = splitValues(splitout.shift() ?? "");

  const rows = splitout.map((it) => splitValues(it));
  const cleanRows = rows.filter((it) => !it.includes(""));
  return { header: header, body: cleanRows };
};

export function convertToDataType<T>(
  header: string[],
  body: (string | number)[][]
) {
  return body.map((valueArray) => {
    const obj: { [key: string]: any } = {};
    header.forEach((header, index) => {
      if (index === 2) {
        // @ts-ignore
        obj[header] = parseInt(valueArray[index]);
      } else {
        obj[header] = valueArray[index];
      }
    });
    return obj;
  });
}

function splitValues(compressedValues: string) {
  return compressedValues.split(",");
}
