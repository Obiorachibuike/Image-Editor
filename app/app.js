(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const defaults = Object.freeze({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    warmth: 0,
    grayscale: 0,
    inversion: 0,
    rotate: 0,
    flipX: 1,
    flipY: 1,
  });
  const colorKeys = [
    "brightness",
    "contrast",
    "saturation",
    "warmth",
    "grayscale",
    "inversion",
  ];
  const presets = [
    { name: "Original", values: {} },
    {
      name: "Golden",
      values: { brightness: 105, contrast: 105, saturation: 110, warmth: 45 },
    },
    {
      name: "Vivid",
      values: { brightness: 103, contrast: 115, saturation: 140 },
    },
    {
      name: "Soft",
      values: { brightness: 110, contrast: 85, saturation: 85, warmth: 10 },
    },
    { name: "Mono", values: { contrast: 110, grayscale: 100 } },
    {
      name: "Fade",
      values: { brightness: 108, contrast: 78, saturation: 65, warmth: 20 },
    },
  ];
  const preview = $("#preview");
  const area = $("#canvas-area");
  const stage = $("#image-stage");
  const fileInput = $("#file-input");
  const ranges = [...document.querySelectorAll("[data-setting]")];
  let state = { ...defaults };
  let image = null;
  let previewSource = null;
  let history = [{ ...defaults }];
  let historyIndex = 0;
  let fileName = "alpine-escape.jpg";
  let selectedLook = "Original";
  let zoom = 1;
  let comparing = false;
  let holdingSpace = false;
  let frame = 0;
  let toastTimer;
  let loadVersion = 0;
  let exporting = false;

  function toast(message, error = false) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").classList.toggle("error", error);
    $("#toast").hidden = false;
    toastTimer = setTimeout(
      () => {
        $("#toast").hidden = true;
      },
      error ? 6000 : 3500,
    );
  }

  function sameState(a, b) {
    return Object.keys(defaults).every((key) => a[key] === b[key]);
  }

  function commit() {
    if (sameState(state, history[historyIndex])) return;
    history = history.slice(0, historyIndex + 1);
    history.push({ ...state });
    if (history.length > 80) history.shift();
    historyIndex = history.length - 1;
    updateControls();
  }

  function outputSize(settings = state) {
    if (!image) return [0, 0];
    return settings.rotate % 180 === 0
      ? [image.naturalWidth, image.naturalHeight]
      : [image.naturalHeight, image.naturalWidth];
  }

  function updateControls() {
    const ready = !!image;
    $("#adjustments").disabled = !ready;
    $("#transforms").disabled = !ready;
    [
      "#export-button",
      "#compare",
      "#zoom-fit",
      "#zoom-out",
      "#zoom-in",
      "#reset-adjustments",
    ].forEach((selector) => {
      $(selector).disabled = !ready;
    });
    $("#undo").disabled = !ready || historyIndex === 0;
    $("#redo").disabled = !ready || historyIndex >= history.length - 1;
    $("#reset-all").disabled = !ready || sameState(state, defaults);
    $("#zoom-out").disabled = !ready || zoom <= 0.5;
    $("#zoom-in").disabled = !ready || zoom >= 4;
    ranges.forEach((range) => {
      const key = range.dataset.setting;
      range.value = state[key];
      range.style.setProperty(
        "--progress",
        `${((state[key] - Number(range.min)) / (Number(range.max) - Number(range.min))) * 100}%`,
      );
      $(`#${key}-value`).innerHTML =
        `${state[key]}${key === "warmth" ? "" : "<span>%</span>"}`;
    });
    selectedLook =
      presets.find((preset) =>
        colorKeys.every(
          (key) => state[key] === (preset.values[key] ?? defaults[key]),
        ),
      )?.name || "";
    document.querySelectorAll(".look-button").forEach((button) => {
      button.disabled = !ready;
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.look === selectedLook),
      );
    });
    $("#rotation-value").textContent = `${state.rotate}°`;
    $('[data-transform="horizontal"]').setAttribute(
      "aria-pressed",
      String(state.flipX === -1),
    );
    $('[data-transform="vertical"]').setAttribute(
      "aria-pressed",
      String(state.flipY === -1),
    );
    $("#compare").setAttribute(
      "aria-pressed",
      String(comparing || holdingSpace),
    );
    $("#compare span").textContent =
      comparing || holdingSpace ? "Back to edits" : "View original";
    $("#original-badge").hidden = !(comparing || holdingSpace);
    $("#dimensions").textContent = `${outputSize().join(" × ")} px`;
    $("#edit-status").textContent = sameState(state, defaults)
      ? "Your next great photo starts here"
      : "Looking good. All changes stay on your device.";
  }

  // The same pixel pipeline powers preview and export. No reliance on Canvas.filter,
  // which is not supported in some browsers, and no image data leaves the device.
  function colorize(source, settings) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, 0, 0);
    if (colorKeys.every((key) => settings[key] === defaults[key]))
      return canvas;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    const brightness = settings.brightness / 100;
    const contrast = settings.contrast / 100;
    const saturation = settings.saturation / 100;
    const gray = settings.grayscale / 100;
    const inverse = settings.inversion / 100;
    const warmth = settings.warmth * 0.3;
    const clamp = (value) => Math.max(0, Math.min(255, value));
    for (let i = 0; i < data.length; i += 4) {
      let r = clamp((clamp(data[i] * brightness) - 127.5) * contrast + 127.5);
      let g = clamp(
        (clamp(data[i + 1] * brightness) - 127.5) * contrast + 127.5,
      );
      let b = clamp(
        (clamp(data[i + 2] * brightness) - 127.5) * contrast + 127.5,
      );
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = clamp(luminance + (r - luminance) * saturation + warmth);
      g = clamp(luminance + (g - luminance) * saturation + warmth * 0.2);
      b = clamp(luminance + (b - luminance) * saturation - warmth);
      const mono = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r += (mono - r) * gray;
      g += (mono - g) * gray;
      b += (mono - b) * gray;
      data[i] = r * (1 - inverse) + (255 - r) * inverse;
      data[i + 1] = g * (1 - inverse) + (255 - g) * inverse;
      data[i + 2] = b * (1 - inverse) + (255 - b) * inverse;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  }

  function draw(source, target, settings) {
    const filtered = colorize(source, settings);
    const sideways = settings.rotate % 180 !== 0;
    target.width = sideways ? filtered.height : filtered.width;
    target.height = sideways ? filtered.width : filtered.height;
    const context = target.getContext("2d");
    context.save();
    context.translate(target.width / 2, target.height / 2);
    context.rotate((settings.rotate * Math.PI) / 180);
    context.scale(settings.flipX, settings.flipY);
    context.drawImage(filtered, -filtered.width / 2, -filtered.height / 2);
    context.restore();
    filtered.width = filtered.height = 0;
  }

  function fitPreview() {
    if (!image) return;
    const settings = comparing || holdingSpace ? defaults : state;
    const [width, height] = outputSize(settings);
    const padding = window.innerWidth <= 800 ? 40 : 76;
    const fit = Math.min(
      Math.max(1, area.clientWidth - padding) / width,
      Math.max(1, area.clientHeight - padding) / height,
      1,
    );
    const displayWidth = Math.max(1, Math.round(width * fit * zoom));
    const displayHeight = Math.max(1, Math.round(height * fit * zoom));
    preview.style.width = `${displayWidth}px`;
    preview.style.height = `${displayHeight}px`;
    stage.style.width = `${Math.max(area.clientWidth, displayWidth + padding)}px`;
    stage.style.height = `${Math.max(area.clientHeight, displayHeight + padding)}px`;
    $("#zoom-value").textContent = `${Math.round(fit * zoom * 100)}%`;
  }

  function render() {
    if (!image || !previewSource) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      draw(
        previewSource,
        preview,
        comparing || holdingSpace ? defaults : state,
      );
      fitPreview();
    });
  }

  function changed() {
    comparing = false;
    updateControls();
    render();
  }

  function makeLooks() {
    const thumbnail = document.createElement("canvas");
    const scale = Math.min(1, 240 / previewSource.width);
    thumbnail.width = Math.max(1, Math.round(previewSource.width * scale));
    thumbnail.height = Math.max(1, Math.round(previewSource.height * scale));
    thumbnail
      .getContext("2d")
      .drawImage(previewSource, 0, 0, thumbnail.width, thumbnail.height);
    const grid = $("#looks-grid");
    grid.replaceChildren();
    presets.forEach((preset) => {
      const button = document.createElement("button");
      button.className = "look-button";
      button.dataset.look = preset.name;
      button.setAttribute("aria-pressed", "false");
      const thumb = colorize(thumbnail, { ...defaults, ...preset.values });
      const img = document.createElement("img");
      img.src = thumb.toDataURL("image/jpeg", 0.8);
      img.alt = "";
      const label = document.createElement("span");
      label.className = "look-label";
      label.innerHTML = `${preset.name}<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>`;
      button.append(img, label);
      button.addEventListener("click", () => {
        colorKeys.forEach((key) => {
          state[key] = preset.values[key] ?? defaults[key];
        });
        commit();
        changed();
      });
      grid.append(button);
    });
  }

  async function loadImage(source, name, size, sample = false) {
    const version = ++loadVersion;
    $("#editor").setAttribute("aria-busy", "true");
    $("#loading-message").textContent = "Preparing your canvas…";
    $("#loading-message").hidden = false;
    try {
      const candidate = new Image();
      candidate.src = source;
      await candidate.decode();
      if (version !== loadVersion) return;
      if (!candidate.naturalWidth || !candidate.naturalHeight)
        throw new Error(
          "This image could not be opened. Try another JPG, PNG, or WebP.",
        );
      if (
        candidate.naturalWidth * candidate.naturalHeight > 32000000 ||
        Math.max(candidate.naturalWidth, candidate.naturalHeight) > 16000
      ) {
        throw new Error(
          "This image is too large to edit safely. Please use an image under 32 megapixels and 16,000 pixels per side.",
        );
      }
      const newSource = document.createElement("canvas");
      const scale = Math.min(
        1,
        1600 / Math.max(candidate.naturalWidth, candidate.naturalHeight),
      );
      newSource.width = Math.max(1, Math.round(candidate.naturalWidth * scale));
      newSource.height = Math.max(
        1,
        Math.round(candidate.naturalHeight * scale),
      );
      newSource
        .getContext("2d")
        .drawImage(candidate, 0, 0, newSource.width, newSource.height);
      image = candidate;
      previewSource = newSource;
      fileName = name;
      state = { ...defaults };
      history = [{ ...defaults }];
      historyIndex = 0;
      zoom = 1;
      comparing = holdingSpace = false;
      area.scrollTop = area.scrollLeft = 0;
      $("#filename").textContent = name;
      const type = name.split(".").pop().toUpperCase();
      const sizeLabel = size
        ? ` · ${size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`}`
        : "";
      $("#file-meta").textContent =
        `${candidate.naturalWidth} × ${candidate.naturalHeight} px · ${type}${sizeLabel}`;
      $("#sample-badge").hidden = !sample;
      makeLooks();
      changed();
      if (!sample) toast("Your photo is ready. Make it yours.");
    } catch (error) {
      if (version !== loadVersion) return;
      toast(
        error.message.startsWith("This image")
          ? error.message
          : "We couldn’t open that image. Please choose a valid JPG, PNG, or WebP.",
        true,
      );
      if (!image) {
        $("#loading-message").textContent =
          "Upload an image to start creating.";
        $("#file-meta").textContent = "No image loaded";
      }
    } finally {
      if (source.startsWith("blob:")) URL.revokeObjectURL(source);
      if (version === loadVersion) {
        $("#editor").setAttribute("aria-busy", "false");
        $("#loading-message").hidden = !!image;
      }
    }
  }

  function openFile(file) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast("Please choose a JPG, PNG, or WebP image.", true);
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast(
        "That file is a little too big. Please choose an image under 25 MB.",
        true,
      );
      return;
    }
    loadImage(URL.createObjectURL(file), file.name, file.size);
  }

  $("#upload-button").addEventListener("click", () => fileInput.click());
  $("#try-upload").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    openFile(fileInput.files[0]);
    fileInput.value = "";
  });
  ranges.forEach((range) => {
    range.addEventListener("input", () => {
      state[range.dataset.setting] = Number(range.value);
      changed();
    });
    range.addEventListener("change", commit);
  });

  document.querySelectorAll("[data-transform]").forEach((button) => {
    button.addEventListener("click", () => {
      switch (button.dataset.transform) {
        case "left":
          state.rotate = (state.rotate + 270) % 360;
          break;
        case "right":
          state.rotate = (state.rotate + 90) % 360;
          break;
        case "horizontal":
          state.flipX *= -1;
          break;
        case "vertical":
          state.flipY *= -1;
          break;
      }
      commit();
      changed();
    });
  });
  $("#reset-adjustments").addEventListener("click", () => {
    if (!image) return;
    colorKeys.forEach((key) => {
      state[key] = defaults[key];
    });
    commit();
    changed();
  });
  $("#reset-all").addEventListener("click", () => {
    if (!image) return;
    state = { ...defaults };
    commit();
    changed();
    toast("A fresh start. All adjustments have been reset.");
  });

  function undo() {
    if (!image || historyIndex <= 0) return;
    state = { ...history[--historyIndex] };
    changed();
  }
  function redo() {
    if (!image || historyIndex >= history.length - 1) return;
    state = { ...history[++historyIndex] };
    changed();
  }
  $("#undo").addEventListener("click", undo);
  $("#redo").addEventListener("click", redo);
  $("#compare").addEventListener("click", () => {
    if (!image) return;
    comparing = !comparing;
    updateControls();
    render();
  });

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function activateTab(tab) {
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      $(`#${item.getAttribute("aria-controls")}`).hidden = !active;
    });
  }
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const target =
          event.key === "Home"
            ? tabs[0]
            : event.key === "End"
              ? tabs[tabs.length - 1]
              : tabs.find((item) => item !== tab);
        activateTab(target);
        target.focus();
      }
    });
  });

  function changeZoom(value) {
    zoom = Math.max(0.5, Math.min(4, value));
    fitPreview();
    updateControls();
    if (zoom === 1) area.scrollTop = area.scrollLeft = 0;
  }
  $("#zoom-in").addEventListener("click", () => changeZoom(zoom + 0.25));
  $("#zoom-out").addEventListener("click", () => changeZoom(zoom - 0.25));
  $("#zoom-fit").addEventListener("click", () => changeZoom(1));
  new ResizeObserver(fitPreview).observe(area);

  let dragDepth = 0;
  document.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragDepth++;
    $("#drop-overlay").hidden = false;
  });
  document.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  });
  document.addEventListener("dragleave", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $("#drop-overlay").hidden = true;
  });
  document.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    dragDepth = 0;
    $("#drop-overlay").hidden = true;
    if (event.dataTransfer.files.length > 1)
      toast("One photo at a time — opening the first image.");
    openFile(event.dataTransfer.files[0]);
  });

  document.addEventListener("keydown", (event) => {
    if (
      !image ||
      event.target.matches("input, textarea, select") ||
      document.querySelector("dialog[open]")
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "y"
    ) {
      event.preventDefault();
      redo();
    } else if (
      event.code === "Space" &&
      !event.repeat &&
      !event.target.closest("button, a, summary")
    ) {
      event.preventDefault();
      holdingSpace = true;
      updateControls();
      render();
    }
  });
  function releaseCompare() {
    if (!holdingSpace) return;
    holdingSpace = false;
    updateControls();
    render();
  }
  document.addEventListener("keyup", (event) => {
    if (event.code === "Space") releaseCompare();
  });
  window.addEventListener("blur", releaseCompare);

  $("#help-button").addEventListener("click", () =>
    $("#help-dialog").showModal(),
  );
  $("#close-help").addEventListener("click", () => $("#help-dialog").close());
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      const bounds = dialog.getBoundingClientRect();
      if (
        event.target === dialog &&
        (event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom)
      )
        dialog.close();
    });
  });

  $("#export-button").addEventListener("click", () => {
    if (!image) return;
    $("#export-name").value = `${fileName.replace(/\.[^.]+$/, "")}-forma`;
    $("#export-dimensions").textContent = `${outputSize().join(" × ")} px`;
    $("#export-dialog").showModal();
  });
  $("#export-format").addEventListener("change", () => {
    $("#quality-control").hidden = $("#export-format").value === "image/png";
  });
  $("#export-quality").addEventListener("input", () => {
    $("#quality-value").textContent = `${$("#export-quality").value}%`;
  });
  $("#close-export").addEventListener("click", () =>
    $("#export-dialog").close(),
  );
  $("#export-dialog form").addEventListener("submit", (event) => {
    event.preventDefault();
    download();
  });

  async function download() {
    if (!image || exporting || !$("#export-name").reportValidity()) return;
    const button = $("#download-button");
    const label = button.innerHTML;
    const snapshot = { ...state };
    const sourceImage = image;
    const format = $("#export-format").value;
    const quality = Number($("#export-quality").value) / 100;
    const name =
      $("#export-name")
        .value.trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
        .replace(/\.(png|jpe?g|webp)$/i, "") || "my-photo-forma";
    exporting = true;
    button.disabled = true;
    button.textContent = "Preparing your image…";
    let fullSource, canvas;
    try {
      // Give the progress state a chance to paint before processing full-resolution pixels.
      await new Promise((resolve) => setTimeout(resolve, 30));
      fullSource = document.createElement("canvas");
      fullSource.width = sourceImage.naturalWidth;
      fullSource.height = sourceImage.naturalHeight;
      fullSource.getContext("2d").drawImage(sourceImage, 0, 0);
      canvas = document.createElement("canvas");
      draw(fullSource, canvas, snapshot);
      if (format === "image/jpeg") {
        const context = canvas.getContext("2d");
        context.globalCompositeOperation = "destination-over";
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error("Encoding failed")),
          format,
          quality,
        );
      });
      const extension =
        { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[
          blob.type
        ] || "png";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name}.${extension}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      $("#export-dialog").close();
      toast("Made by you. Your edited image is downloading.");
    } catch (error) {
      console.error("Image export failed:", error);
      toast(
        "Your image couldn’t be exported. Please try again, or choose a smaller image.",
        true,
      );
    } finally {
      if (fullSource) fullSource.width = fullSource.height = 0;
      if (canvas) canvas.width = canvas.height = 0;
      exporting = false;
      button.disabled = false;
      button.innerHTML = label;
    }
  }
  updateControls();
  loadImage("assets/alpine-escape.jpg", fileName, 0, true);
})();
