declare module "@paystack/inline-js" {
  export default class PaystackPop {
    resumeTransaction(
      accessCode: string,
      callbacks?: {
        onSuccess?: (transaction: { reference?: string }) => void;
        onCancel?: () => void;
      }
    ): void;
  }
}
