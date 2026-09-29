const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");

async function ready(page) {
  await page.goto("/");
  await expect(page.locator("#export-button")).toBeEnabled();
  await expect(page.locator("#loading-message")).toBeHidden();
}

async function fixture(page, name = "quadrants.png", transparent = false) {
  const base64 = await page.evaluate((transparent) => {
    const canvas = document.createElement("canvas");
    canvas.width = 60;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    [
      ["#ff0000", 0, 0],
      ["#00ff00", 30, 0],
      ["#0000ff", 0, 20],
      ["#ffff00", 30, 20],
    ].forEach(([color, x, y]) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 30, 20);
    });
    if (transparent) ctx.clearRect(0, 0, 10, 10);
    return canvas.toDataURL("image/png").split(",")[1];
  }, transparent);
  await page
    .locator("#file-input")
    .setInputFiles({
      name,
      mimeType: "image/png",
      buffer: Buffer.from(base64, "base64"),
    });
  await expect(page.locator("#filename")).toHaveText(name);
  await expect(page.locator("#dimensions")).toHaveText("60 × 40 px");
  return base64;
}

async function pixel(page, x, y) {
  return page
    .locator("#preview")
    .evaluate(
      (canvas, [x, y]) =>
        Array.from(canvas.getContext("2d").getImageData(x, y, 1, 1).data),
      [x, y],
    );
}

async function slider(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, String(value));
}

async function exportImage(page, format = "image/png") {
  await page.locator("#export-button").click();
  await page.locator("#export-format").selectOption(format);
  const downloading = page.waitForEvent("download");
  await page.locator("#download-button").click();
  const download = await downloading;
  const data = await fs.readFile(await download.path());
  const result = await page.evaluate(
    async ({ base64, format }) => {
      const img = new Image();
      img.src = `data:${format};base64,${base64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        pixels: Array.from(
          ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        ),
        firstPixel: Array.from(ctx.getImageData(0, 0, 1, 1).data),
      };
    },
    { base64: data.toString("base64"), format },
  );
  return {
    ...result,
    filename: download.suggestedFilename(),
    bytes: data.length,
  };
}

test("opens the sample without errors or third-party requests", async ({
  page,
}) => {
  const errors = [];
  const external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:3000") &&
      !request.url().startsWith("data:")
    )
      external.push(request.url());
  });
  await ready(page);
  await expect(
    page.getByRole("heading", { name: "Make a good photo yours." }),
  ).toBeVisible();
  await expect(page.locator("#sample-badge")).toBeVisible();
  await expect(page.locator("#reset-all")).toBeDisabled();
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#preview")).toHaveJSProperty("width", 1264);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("adjustments change pixels and can be undone, redone, and reset", async ({
  page,
}) => {
  await ready(page);
  await fixture(page);
  await slider(page, "brightness", 50);
  await expect(page.locator("#brightness-value")).toHaveText("50%");
  await expect.poll(() => pixel(page, 5, 5)).toEqual([128, 0, 0, 255]);
  await page.locator("#undo").click();
  await expect.poll(() => pixel(page, 5, 5)).toEqual([255, 0, 0, 255]);
  await page.locator("#redo").click();
  await expect.poll(() => pixel(page, 5, 5)).toEqual([128, 0, 0, 255]);
  await page.locator("#reset-all").click();
  await expect(page.locator("#brightness")).toHaveValue("100");
  await expect(page.locator("#reset-all")).toBeDisabled();
  await page.locator("#undo").click();
  await expect(page.locator("#brightness")).toHaveValue("50");
});

test("grayscale, inversion, contrast, saturation and warmth are functional", async ({
  page,
}) => {
  await ready(page);
  await fixture(page);
  await slider(page, "grayscale", 100);
  await expect.poll(() => pixel(page, 5, 5)).toEqual([54, 54, 54, 255]);
  await page.locator("#reset-adjustments").click();
  await slider(page, "inversion", 100);
  await expect.poll(() => pixel(page, 5, 5)).toEqual([0, 255, 255, 255]);
  await page.locator("#reset-adjustments").click();
  await slider(page, "contrast", 0);
  await expect.poll(() => pixel(page, 5, 5)).toEqual([128, 128, 128, 255]);
  await page.locator("#reset-adjustments").click();
  await slider(page, "saturation", 0);
  await expect.poll(() => pixel(page, 5, 5)).toEqual([54, 54, 54, 255]);
  await page.locator("#reset-adjustments").click();
  await slider(page, "warmth", -100);
  await expect.poll(() => pixel(page, 5, 5)).toEqual([225, 0, 30, 255]);
});

test("rotate and flip use correct axes and do not crop", async ({ page }) => {
  await ready(page);
  await fixture(page);
  await page.getByRole("button", { name: "Rotate right 90 degrees" }).click();
  await expect(page.locator("#dimensions")).toHaveText("40 × 60 px");
  await expect.poll(() => pixel(page, 5, 5)).toEqual([0, 0, 255, 255]);
  await expect(page.locator("#preview")).toHaveJSProperty("width", 40);
  await expect(page.locator("#preview")).toHaveJSProperty("height", 60);
  await page.getByRole("button", { name: "Rotate left 90 degrees" }).click();
  await expect.poll(() => pixel(page, 5, 5)).toEqual([255, 0, 0, 255]);
  await page
    .getByRole("button", { name: "Flip horizontally", exact: true })
    .click();
  await expect.poll(() => pixel(page, 5, 5)).toEqual([0, 255, 0, 255]);
  await page.locator("#reset-all").click();
  await page
    .getByRole("button", { name: "Flip vertically", exact: true })
    .click();
  await expect.poll(() => pixel(page, 5, 5)).toEqual([0, 0, 255, 255]);
});

test("looks, comparison and keyboard shortcuts preserve edits", async ({
  page,
}) => {
  await ready(page);
  await fixture(page);
  await page.getByRole("tab", { name: "Looks" }).click();
  await expect(page.locator("#looks-panel")).toBeVisible();
  await page.getByRole("button", { name: "Mono", exact: true }).click();
  await expect.poll(() => pixel(page, 5, 5)).toEqual([54, 54, 54, 255]);
  await page.locator("#compare").click();
  await expect(page.locator("#original-badge")).toBeVisible();
  await expect.poll(() => pixel(page, 5, 5)).toEqual([255, 0, 0, 255]);
  await page.locator("#compare").click();
  await expect.poll(() => pixel(page, 5, 5)).toEqual([54, 54, 54, 255]);
  await page.locator("#page-title").click();
  await page.keyboard.down("Space");
  await expect.poll(() => pixel(page, 5, 5)).toEqual([255, 0, 0, 255]);
  await page.keyboard.up("Space");
  await expect.poll(() => pixel(page, 5, 5)).toEqual([54, 54, 54, 255]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => pixel(page, 5, 5)).toEqual([255, 0, 0, 255]);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => pixel(page, 5, 5)).toEqual([54, 54, 54, 255]);
});

test("PNG export exactly matches transformed, adjusted preview", async ({
  page,
}) => {
  await ready(page);
  await fixture(page);
  await slider(page, "brightness", 80);
  await slider(page, "warmth", 30);
  await page.getByRole("button", { name: "Rotate right 90 degrees" }).click();
  await page
    .getByRole("button", { name: "Flip horizontally", exact: true })
    .click();
  await expect(page.locator("#preview")).toHaveJSProperty("width", 40);
  const previewPixels = await page
    .locator("#preview")
    .evaluate((canvas) =>
      Array.from(
        canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height)
          .data,
      ),
    );
  const result = await exportImage(page);
  expect(result.filename).toBe("quadrants-forma.png");
  expect([result.width, result.height]).toEqual([40, 60]);
  expect(result.pixels).toEqual(previewPixels);
});

test("PNG preserves alpha, JPG flattens on white, WebP exports correctly", async ({
  page,
}) => {
  await ready(page);
  await fixture(page, "transparent.png", true);
  const png = await exportImage(page);
  expect(png.firstPixel[3]).toBe(0);
  const jpg = await exportImage(page, "image/jpeg");
  expect(jpg.filename).toBe("transparent-forma.jpg");
  expect(jpg.firstPixel.every((channel) => channel >= 240)).toBe(true);
  const webp = await exportImage(page, "image/webp");
  expect(webp.filename).toBe("transparent-forma.webp");
  expect([webp.width, webp.height]).toEqual([60, 40]);
  expect(webp.firstPixel[3]).toBe(0);
});

test("export uses the edits even while viewing original", async ({ page }) => {
  await ready(page);
  await fixture(page);
  await slider(page, "brightness", 50);
  await page.locator("#compare").click();
  const result = await exportImage(page);
  expect(result.firstPixel).toEqual([128, 0, 0, 255]);
});

test("new upload resets history and edits; canceled picker is harmless", async ({
  page,
}) => {
  await ready(page);
  await slider(page, "brightness", 40);
  await fixture(page, "fresh.png");
  await expect(page.locator("#brightness")).toHaveValue("100");
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#sample-badge")).toBeHidden();
  await page.locator("#file-input").setInputFiles([]);
  await expect(page.locator("#filename")).toHaveText("fresh.png");
  await expect(page.locator("#export-button")).toBeEnabled();
});

test("invalid and corrupt uploads keep the current image usable", async ({
  page,
}) => {
  await ready(page);
  await page
    .locator("#file-input")
    .setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
  await expect(page.locator("#toast")).toContainText("Please choose a JPG");
  await expect(page.locator("#filename")).toHaveText("alpine-escape.jpg");
  await page
    .locator("#file-input")
    .setInputFiles({
      name: "corrupt.png",
      mimeType: "image/png",
      buffer: Buffer.from("not a png"),
    });
  await expect(page.locator("#toast")).toContainText("couldn’t open");
  await expect(page.locator("#export-button")).toBeEnabled();
  await expect(page.locator("#loading-message")).toBeHidden();
});

test("drag and drop loads an image locally", async ({ page }) => {
  await ready(page);
  const base64 = await fixture(page);
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    document.dispatchEvent(
      new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer }),
    );
    document.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
    );
  }, base64);
  await expect(page.locator("#filename")).toHaveText("dropped.png");
  await expect(page.locator("#drop-overlay")).toBeHidden();
});

test("zoom and fit change only the view; quick guide opens and dismisses", async ({
  page,
}) => {
  await ready(page);
  const initial = await page.locator("#preview").boundingBox();
  await page.locator("#zoom-in").click();
  const enlarged = await page.locator("#preview").boundingBox();
  expect(enlarged.width).toBeGreaterThan(initial.width);
  await page.locator("#zoom-fit").click();
  expect((await page.locator("#preview").boundingBox()).width).toBe(
    initial.width,
  );
  await page.locator("#help-button").click();
  await expect(
    page.getByRole("dialog", { name: "From good to you." }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#help-dialog")).toBeHidden();
});

for (const width of [390, 768, 1280]) {
  test(`responsive layout fits a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const canvas = await page.locator("#preview").boundingBox();
    const area = await page.locator("#canvas-area").boundingBox();
    expect(canvas.x).toBeGreaterThanOrEqual(area.x);
    expect(canvas.y).toBeGreaterThanOrEqual(area.y);
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(area.x + area.width);
    expect(canvas.y + canvas.height).toBeLessThanOrEqual(area.y + area.height);
    await expect(page.locator("#upload-button")).toBeVisible();
  });
}

test("legacy entry point still opens the editor", async ({ page }) => {
  await page.goto("/html/index.html");
  await expect(page.locator("#export-button")).toBeEnabled();
  await expect(page).toHaveURL(/\/index\.html$/);
});

test("export stays full resolution when preview is downscaled", async ({
  page,
}) => {
  await ready(page);
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2000;
    canvas.height = 1000;
    canvas.getContext("2d").fillRect(0, 0, 2000, 1000);
    return canvas.toDataURL().split(",")[1];
  });
  await page
    .locator("#file-input")
    .setInputFiles({
      name: "large.png",
      mimeType: "image/png",
      buffer: Buffer.from(base64, "base64"),
    });
  await expect(page.locator("#filename")).toHaveText("large.png");
  await expect(page.locator("#preview")).toHaveJSProperty("width", 1600);
  await page.getByRole("button", { name: "Rotate right 90 degrees" }).click();
  await page.locator("#export-button").click();
  const downloading = page.waitForEvent("download");
  await page.locator("#download-button").click();
  const bytes = await fs.readFile(await (await downloading).path());
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
    1000, 2000,
  ]);
});

test("export dialog supports keyboard submission and closing with an empty name", async ({
  page,
}) => {
  await ready(page);
  await fixture(page);
  await page.locator("#export-button").click();
  await page.locator("#export-name").fill("");
  await page.locator("#close-export").click();
  await expect(page.locator("#export-dialog")).toBeHidden();
  await page.locator("#export-button").click();
  await page.locator("#export-name").fill("my-creation");
  const downloading = page.waitForEvent("download");
  await page.locator("#export-name").press("Enter");
  expect((await downloading).suggestedFilename()).toBe("my-creation.png");
});
