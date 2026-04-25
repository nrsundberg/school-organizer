import { Button } from "@heroui/react";
import { Form, useSubmit } from "react-router";
import { type Dispatch, type SetStateAction, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function MinimalCsvFileChooser({
  file,
  setFile
}: {
  file: File | null;
  setFile: Dispatch<SetStateAction<File | null>>;
}) {
  const { t } = useTranslation("common");
  const fileInputRef = useRef(null);

  const handleButtonClick = () => {
    // @ts-ignore
    fileInputRef.current && fileInputRef.current.click();
  };

  return (
    <>
      <input
        type="file"
        id="file"
        name="file"
        ref={fileInputRef}
        onChange={(e) => setFile(e.currentTarget.files!.item(0))}
        accept=".csv, .CSV, .xlsx, .XLSX"
        hidden
      />
      <Button onPress={handleButtonClick}>{t("buttons.selectFile")}</Button>
      <div className="auto-rows-auto">
        {file ? (
          <>
            <p className="text-s">{t("fileChooser.fileLabel", { name: file?.name })}</p>
            <p className="text-s" suppressHydrationWarning>
              {t("fileChooser.lastModified", { value: new Date(file?.lastModified).toLocaleString() })}
            </p>
          </>
        ) : null}
      </div>
    </>
  );
}

export function MinimalJsonFileChooser() {
  const { t } = useTranslation("common");
  const fileInputRef = useRef(null);
  const [file, setFile] = useState<File | null>(null);
  const submit = useSubmit();
  // useEffect(() => {
  //   if (jsonFile) {
  //     const formData = new FormData();
  //     formData.append("file", jsonFile)
  //     fetcher.submit(formData);
  //   }
  // }, []);

  const handleButtonClick = () => {
    // @ts-ignore
    fileInputRef.current && fileInputRef.current.click();
  };

  // useEffect(() => {
  //   if (file !== null) {
  //     console.log("submitting");
  //     const formData = new FormData();
  //     formData.append("file", file);
  //     submit(formData, { to: "/generate/create" });
  //   }
  // }, [file]);

  return (
    <Form
      encType="multipart/form-data"
      method="post"
      onChange={(event) => {
        submit(event.currentTarget);
      }}
    >
      <input
        type="file"
        id="file"
        name="file"
        ref={fileInputRef}
        onChange={(e) => setFile(e.currentTarget.files!.item(0))}
        accept=".json, .JSON"
        hidden
      />
      <Button onPress={handleButtonClick}>{t("buttons.selectFile")}</Button>
      <div className="auto-rows-auto">
        {file && (
          <>
            <p className="text-xs">{t("fileChooser.fileLabel", { name: file?.name })}</p>
            <p className="text-xs" suppressHydrationWarning>
              {t("fileChooser.lastModified", { value: new Date(file?.lastModified).toLocaleString() })}
            </p>
          </>
        )}
      </div>
    </Form>
  );
}
