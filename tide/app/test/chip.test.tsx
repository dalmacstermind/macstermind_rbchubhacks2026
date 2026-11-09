import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Chip } from "../src/renderer/src/ui";

describe("Chip", () => {
  it("stays on one line by default", () => {
    expect(renderToString(<Chip tone="done">Done</Chip>)).toContain("whitespace-nowrap");
  });

  it("can wrap a long message so it stays inside its frame", () => {
    const html = renderToString(
      <Chip tone="done" wrap>
        A long message
      </Chip>,
    );
    expect(html).not.toContain("whitespace-nowrap");
    expect(html).toContain("A long message");
  });
});
