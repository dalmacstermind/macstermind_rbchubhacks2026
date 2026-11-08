// Add or correct the date a video was recorded, which places it on the Trends graphs.
import { useState } from "react";
import { api } from "../api";
import { FUTURE_DATE_MESSAGE, Field, Modal, btnGhost, btnPrimary, today } from "../ui";

export type VideoToDate = { videoId: number; fileName: string; recordedAt: string };

export function VideoDateDialog({
  video,
  onClose,
  onSaved,
}: {
  video: VideoToDate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(video.recordedAt);
  const [error, setError] = useState("");
  const save = async () => {
    if (date > today()) return setError(FUTURE_DATE_MESSAGE);
    try {
      await api.videos.details(video.videoId, { recordedAt: date });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="Recording date"
      onClose={onClose}
      footer={
        <>
          <button className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button className={btnPrimary} disabled={!date} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <p className="mb-4 break-all text-sm text-muted-foreground">{video.fileName}</p>
      <Field label="Date recorded">
        <input type="date" className="input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </Modal>
  );
}
