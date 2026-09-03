import { useEffect, useState } from "react";
import { resolveProofUrl } from "@/lib/proofUrl";

interface ProofImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | null | undefined;
}

/** Renders a payment proof image from the private storage bucket via a signed URL. */
export function ProofImage({ src, alt = "payment proof", ...rest }: ProofImageProps) {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setResolved(null);
    resolveProofUrl(src).then((url) => {
      if (active) setResolved(url);
    });
    return () => {
      active = false;
    };
  }, [src]);

  if (!resolved) return null;
  return <img src={resolved} alt={alt} {...rest} />;
}
