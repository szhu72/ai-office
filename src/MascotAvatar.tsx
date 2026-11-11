import { useEffect, useRef, useState } from "react";

const sourceImage = "/mimi-reference.png";

export default function MascotAvatar() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      console.error("Could not initialize the mascot avatar canvas.");
      return;
    }

    const image = new Image();
    image.onload = () => {
      const cropSize = Math.min(image.naturalWidth * 0.76, image.naturalHeight * 0.76);
      const cropX = (image.naturalWidth - cropSize) / 2;
      const cropY = image.naturalHeight * 0.035;

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.fillStyle = "#f3ead6";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        cropX,
        cropY,
        cropSize,
        cropSize,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      setLoaded(true);
    };
    image.onerror = () => console.error(`Could not load the mascot reference image: ${sourceImage}`);
    image.src = sourceImage;
  }, []);

  return (
    <>
      {!loaded && <span aria-hidden="true">🐩</span>}
      <canvas
        ref={canvasRef}
        className={`mascot-pixel-canvas${loaded ? " avatar-visible" : ""}`}
        width={24}
        height={24}
        aria-label="依米米參考照製作的貴賓狗像素風頭像"
        role="img"
      />
    </>
  );
}
