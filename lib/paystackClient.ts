"use client";

/**
 * Opens the Paystack inline popup, matching the pattern already proven
 * working on the e-commerce platform's gift card checkout — dynamic
 * import of @paystack/inline-js, resumeTransaction(accessCode), fall
 * back to a full-page redirect if the package fails to load or if no
 * accessCode was provided.
 *
 * This deliberately does NOT use the window.PaystackPop global loaded
 * via a manually-injected <script> tag — that approach was tried first
 * and didn't reliably work (window.PaystackPop was inconsistently
 * available by the time the button was clicked). The installed npm
 * package is bundled and available immediately, which is what the
 * working project actually relies on.
 */

export interface OpenPaystackParams {
  accessCode: string | null | undefined;
  authorizationUrl: string; // fallback if the popup can't load or there's no accessCode
  onSuccess?: (reference: string) => void;
  onCancel?: () => void;
}

export async function openPaystackCheckout(params: OpenPaystackParams): Promise<void> {
  if (!params.accessCode) {
    window.location.href = params.authorizationUrl;
    return;
  }

  try {
    const PaystackPop = (await import("@paystack/inline-js")).default;
    const popup = new PaystackPop();

    popup.resumeTransaction(params.accessCode, {
      onSuccess: (transaction: { reference?: string }) => {
        params.onSuccess?.(transaction?.reference ?? "");
      },
      onCancel: () => {
        params.onCancel?.();
      },
    });
  } catch {
    // Inline JS failed to load or resumeTransaction threw — fall back to
    // the hosted checkout page so the payment isn't just abandoned.
    window.location.href = params.authorizationUrl;
  }
}
