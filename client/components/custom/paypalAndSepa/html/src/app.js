async function onPayPalWebSdkLoaded() {
  try {
    const clientId = await getBrowserSafeClientId();

    // The v6 SDK is designed around a single instance per page: component
    // scripts register themselves into one page-global registry, so a second
    // createInstance() call does not isolate SEPA from the PayPal buttons.
    const sdkInstance = await window.paypal.createInstance({
      clientId,
      components: ["paypal-payments", "sepa-payments"],
      pageType: "checkout",
      testBuyerCountry: "DE", // Germany for SEPA testing
      locale: "de-DE",
    });

    // findEligibleMethods() defaults its payment_sources to every method
    // declared by the globally registered components, which would include SEPA.
    // find-eligible-methods rejects SEPA as a payment source
    // (INVALID_PARAMETER_VALUE), so the list is pinned to the PayPal methods
    // that actually have an eligibility check.
    const paymentMethods = await sdkInstance.findEligibleMethods({
      currencyCode: "EUR",
      paymentMethods: ["PAYPAL"],
    });

    if (paymentMethods.isEligible("paypal")) {
      configurePayPalButton(sdkInstance);
    }

    // SEPA performs no eligibility check, so its button is always configured.
    configureSepaPayment(sdkInstance);
  } catch (error) {
    renderAlert({
      type: "danger",
      message: "Failed to initialize the PayPal Web SDK",
    });
    console.error(error);
  }
}

const paymentSessionOptions = {
  async onApprove(data) {
    console.log("onApprove", data);
    const orderData = await captureOrder({
      orderId: data.orderId,
    });
    renderAlert({
      type: "success",
      message: `Order successfully captured! ${JSON.stringify(data)}`,
    });
    console.log("Capture result", orderData);
  },
  onCancel(data) {
    renderAlert({
      type: "warning",
      message: `onCancel() callback called ${data.orderId ?? ""}`,
    });
    console.log("onCancel", data);
  },
  onError(error) {
    renderAlert({
      type: "danger",
      message: `onError() callback called: ${error.message}`,
    });
    console.log("onError", error);
  },
};

async function configurePayPalButton(sdkInstance) {
  const paypalPaymentSession = sdkInstance.createPayPalOneTimePaymentSession(
    paymentSessionOptions,
  );

  const paypalButton = document.querySelector("#paypal-button");
  paypalButton.removeAttribute("hidden");

  paypalButton.addEventListener("click", async () => {
    try {
      // get the promise reference by invoking createOrder()
      // do not await this async function since it can cause transient activation issues
      const createOrderPromise = createOrder();
      await paypalPaymentSession.start(
        { presentationMode: "auto" },
        createOrderPromise,
      );
    } catch (error) {
      renderAlert({
        type: "danger",
        message: `PayPal Button click failure: ${error.message}`,
      });
      console.error(error);
    }
  });
}

function configureSepaPayment(sdkInstance) {
  const sepaPaymentSession = sdkInstance.createSepaOneTimePaymentSession(
    paymentSessionOptions,
  );

  const sepaButton = document.querySelector("#sepa-button");
  sepaButton.removeAttribute("hidden");

  sepaButton.addEventListener("click", async () => {
    try {
      const isValid = await sepaPaymentSession.validate();

      if (!isValid) {
        renderAlert({
          type: "danger",
          message: "SEPA payment session validation failed",
        });
        return;
      }

      // get the promise reference by invoking createOrder()
      // do not await this async function since it can cause transient activation issues
      const createOrderPromise = createOrder();
      await sepaPaymentSession.start(
        { presentationMode: "auto" },
        createOrderPromise,
      );
    } catch (error) {
      renderAlert({
        type: "danger",
        message: `SEPA Button click failure: ${error.message}`,
      });
      console.error(error);
    }
  });
}

async function getBrowserSafeClientId() {
  const response = await fetch("/paypal-api/auth/browser-safe-client-id", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error("Failed to fetch client id");
  }
  const { clientId } = await response.json();

  return clientId;
}

async function createOrder() {
  const response = await fetch(
    "/paypal-api/checkout/orders/create-order-for-one-time-payment",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currencyCode: "EUR" }),
    },
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Order creation failed ${data ? JSON.stringify(data) : ""}`,
    );
  }

  renderAlert({
    type: "info",
    message: `Order successfully created: ${data.id}`,
  });

  return { orderId: data.id };
}

async function captureOrder({ orderId }) {
  const response = await fetch(
    `/paypal-api/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Order capture failed ${data?.name ?? ""}`);
  }

  return data;
}

function renderAlert({ type, message }) {
  const alertComponentElement = document.querySelector("alert-component");
  if (!alertComponentElement) {
    return;
  }

  alertComponentElement.setAttribute("type", type);
  alertComponentElement.innerText = message;
}
