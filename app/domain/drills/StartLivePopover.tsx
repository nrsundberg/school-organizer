import { Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { useFetcher } from "react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Radio } from "lucide-react";
import type { DrillAudience } from "~/domain/drills/types";

export function StartLivePopover({
  templateId,
  templateName,
  defaultAudience,
}: {
  templateId: string;
  templateName: string;
  defaultAudience: DrillAudience;
}) {
  const { t } = useTranslation("admin");
  const [audience, setAudience] = useState<DrillAudience>(defaultAudience);
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher();

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <PopoverTrigger>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 transition-colors"
        >
          <Radio className="w-3.5 h-3.5" />
          {t("drills.list.startLive")}
        </button>
      </PopoverTrigger>
      <PopoverContent placement="bottom end" className="p-0">
        <fetcher.Form method="post" className="flex flex-col gap-3 p-4 w-72">
          <input type="hidden" name="intent" value="start-live" />
          <input type="hidden" name="id" value={templateId} />
          <div>
            <h3 className="text-sm font-semibold">
              {t("drills.list.startConfirm.heading")}
            </h3>
            <p className="text-xs text-white/60 mt-0.5">
              {t("drills.list.startConfirm.subhead", { name: templateName })}
            </p>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-white/50">
              {t("drills.list.startConfirm.audienceLabel")}
            </legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="audience"
                value="EVERYONE"
                checked={audience === "EVERYONE"}
                onChange={() => setAudience("EVERYONE")}
              />
              <span>{t("drills.list.startConfirm.audienceEveryone")}</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="audience"
                value="STAFF_ONLY"
                checked={audience === "STAFF_ONLY"}
                onChange={() => setAudience("STAFF_ONLY")}
              />
              <span>{t("drills.list.startConfirm.audienceStaffOnly")}</span>
            </label>
          </fieldset>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="text-sm text-white/60 hover:text-white px-2"
              onClick={() => setOpen(false)}
            >
              {t("drills.list.startConfirm.cancel")}
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 transition-colors disabled:opacity-50"
              disabled={fetcher.state !== "idle"}
            >
              <Radio className="w-3.5 h-3.5" />
              {t("drills.list.startConfirm.confirm")}
            </button>
          </div>
        </fetcher.Form>
      </PopoverContent>
    </Popover>
  );
}

export default StartLivePopover;
