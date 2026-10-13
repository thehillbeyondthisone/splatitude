// Read the browser's composited frame. A WebGL readPixels probe can see a
// cleared drawing buffer while Spark's asynchronous render is visibly intact.
export async function visibleFraction(page) {
  await page.evaluate(() => __bench.settled());
  const png = await page.locator('#stage canvas').first().screenshot();
  return page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let visible = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 70) visible++;
    return visible / (canvas.width * canvas.height);
  }, png.toString('base64'));
}

export async function waitForRendered(page, minimum = 0.2) {
  const deadline = Date.now() + 10000;
  let fraction = 0;
  while (Date.now() < deadline) {
    fraction = await visibleFraction(page);
    if (fraction > minimum) return fraction;
    await page.waitForTimeout(200);
  }
  throw new Error(`Scene did not become visible; coverage ${fraction}`);
}
