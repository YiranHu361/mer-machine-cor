/** Checkout copy follows the saved payment, never an animation timer. */
export function paymentNotice(payment?: {
  status: string;
  reason?: string;
  transactionHash?: string;
}) {
  if (payment?.status === "failed") {
    const unused = payment.reason?.startsWith("Test payment expired without a transfer.");
    return {
      title: unused ? "Test payment expired" : "Payment failed",
      body: unused
        ? "The test payment expired without a transfer. Nothing was charged or printed. Start a new order to try again."
        : "Payment failed; nothing was made. Start again when you are ready.",
      waiting: false,
    };
  }
  if (payment?.status === "pending" && !payment.transactionHash)
    return {
      title: "Recovering your test payment",
      body: "The payment service did not return a receipt. We’re checking whether it went through. Please don’t pay again; printing has not started.",
      waiting: false,
    };
  return {
    title: "Confirming your test payment",
    body: "Waiting for Base Sepolia to confirm the test payment. Printing starts after confirmation.",
    waiting: true,
  };
}
