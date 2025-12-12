'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

/**
 * Dummy Checkout Test Page
 *
 * This page allows testing the Lulu API integration without Stripe.
 * It displays the price quote from Lulu and simulates payment completion.
 *
 * Usage: /checkout/test?bookId=xxx
 */

interface PriceQuote {
  bookId: string;
  bookTitle: string;
  pageCount: number;
  quantity: number;
  shippingOption: string;
  costs: {
    printCost: string;
    shippingCost: string;
    subtotal: string;
    tax: string;
    total: string;
    currency: string;
  };
}

interface ShippingOption {
  level: string;
  costExclTax: string;
  costInclTax: string;
  currency: string;
  estimatedDelivery: {
    min: string;
    max: string;
  };
}

const TEST_ADDRESS = {
  name: 'Test User',
  street1: '101 Independence Ave SE',
  city: 'Washington',
  stateCode: 'DC',
  postcode: '20540',
  countryCode: 'US',
  phoneNumber: '+1 206 555 0100',
  email: 'test@storywink.ai',
};

const SHIPPING_LABELS: Record<string, string> = {
  MAIL: 'Standard Mail (7-14 days)',
  PRIORITY_MAIL: 'Priority Mail (4-7 days)',
  GROUND: 'Ground (5-10 days)',
  EXPEDITED: 'Expedited (3-5 days)',
  EXPRESS: 'Express (1-3 days)',
};

function DummyCheckoutContent() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get('bookId');
  const { getToken } = useAuth();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [shippingLevel, setShippingLevel] = useState('MAIL');
  const [priceQuote, setPriceQuote] = useState<PriceQuote | null>(null);
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [orderCreated, setOrderCreated] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Fetch shipping options on mount
  useEffect(() => {
    if (bookId) {
      fetchShippingOptions();
    }
  }, [bookId]);

  // Fetch price quote when quantity or shipping changes
  useEffect(() => {
    if (bookId && shippingLevel) {
      fetchPriceQuote();
    }
  }, [bookId, quantity, shippingLevel]);

  const getApiUrl = () => {
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  };

  const fetchShippingOptions = async () => {
    try {
      const token = await getToken();
      const response = await fetch(`${getApiUrl()}/api/print-orders/shipping-options`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookId,
          quantity,
          shippingAddress: {
            name: TEST_ADDRESS.name,
            street1: TEST_ADDRESS.street1,
            city: TEST_ADDRESS.city,
            state_code: TEST_ADDRESS.stateCode,
            country_code: TEST_ADDRESS.countryCode,
            postcode: TEST_ADDRESS.postcode,
          },
        }),
      });

      const data = await response.json();
      if (data.success) {
        setShippingOptions(data.data.shippingOptions);
      }
    } catch (err) {
      console.error('Failed to fetch shipping options:', err);
    }
  };

  const fetchPriceQuote = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      const response = await fetch(`${getApiUrl()}/api/print-orders/calculate-price`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookId,
          quantity,
          shippingOption: shippingLevel,
          shippingAddress: {
            name: TEST_ADDRESS.name,
            street1: TEST_ADDRESS.street1,
            city: TEST_ADDRESS.city,
            state_code: TEST_ADDRESS.stateCode,
            country_code: TEST_ADDRESS.countryCode,
            postcode: TEST_ADDRESS.postcode,
          },
        }),
      });

      const data = await response.json();

      if (data.success) {
        setPriceQuote(data.data);
      } else {
        setError(data.error || 'Failed to get price quote');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleSimulatePayment = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const token = await getToken();

      // Step 1: Create order with test flag
      const orderResponse = await fetch(`${getApiUrl()}/api/print-orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookId,
          quantity,
          shippingLevel,
          shippingAddress: TEST_ADDRESS,
          isTest: true, // This marks it as PAYMENT_COMPLETED immediately
        }),
      });

      const orderData = await orderResponse.json();

      if (!orderData.success) {
        throw new Error(orderData.error || 'Failed to create order');
      }

      setOrderCreated(orderData.data.id);

      // Step 2: Generate PDFs
      const [interiorRes, coverRes] = await Promise.all([
        fetch(`/api/book/${bookId}/export/lulu-interior`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
        }),
        fetch(`/api/book/${bookId}/export/lulu-cover`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
        }),
      ]);

      const interiorData = await interiorRes.json();
      const coverData = await coverRes.json();

      if (!interiorData.success || !coverData.success) {
        throw new Error('Failed to generate PDFs');
      }

      // Step 3: Submit to Lulu (optional for testing)
      // Uncomment this to actually submit to Lulu sandbox
      /*
      const submitResponse = await fetch(`${getApiUrl()}/api/print-orders/${orderData.data.id}/submit-to-lulu`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          interiorPdfUrl: interiorData.url,
          coverPdfUrl: coverData.url,
          shippingLevel,
        }),
      });

      const submitData = await submitResponse.json();
      console.log('Submitted to Lulu:', submitData);
      */

      alert(`Order created successfully!\n\nOrder ID: ${orderData.data.id}\nInterior PDF: ${interiorData.url}\nCover PDF: ${coverData.url}`);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process order');
    } finally {
      setSubmitting(false);
    }
  };

  if (!bookId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Dummy Checkout Test</h1>
          <p className="text-red-600">Missing bookId parameter.</p>
          <p className="text-gray-600 mt-2">
            Usage: <code className="bg-gray-100 px-2 py-1 rounded">/checkout/test?bookId=xxx</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Lulu API Test Checkout</h1>
            <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2.5 py-0.5 rounded">
              TEST MODE
            </span>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Test Address Section */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h2 className="font-semibold text-gray-700 mb-2">Test Shipping Address</h2>
            <p className="text-sm text-gray-600">{TEST_ADDRESS.name}</p>
            <p className="text-sm text-gray-600">{TEST_ADDRESS.street1}</p>
            <p className="text-sm text-gray-600">
              {TEST_ADDRESS.city}, {TEST_ADDRESS.stateCode} {TEST_ADDRESS.postcode}
            </p>
            <p className="text-sm text-gray-600">{TEST_ADDRESS.countryCode}</p>
          </div>

          {/* Quantity Selector */}
          <div className="mb-6">
            <label className="block font-semibold text-gray-700 mb-2">Quantity</label>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-10 h-10 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100"
                disabled={quantity <= 1}
              >
                -
              </button>
              <span className="text-xl font-semibold w-8 text-center">{quantity}</span>
              <button
                onClick={() => setQuantity(Math.min(10, quantity + 1))}
                className="w-10 h-10 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100"
                disabled={quantity >= 10}
              >
                +
              </button>
            </div>
          </div>

          {/* Shipping Options */}
          <div className="mb-6">
            <label className="block font-semibold text-gray-700 mb-2">Shipping Method</label>
            <div className="space-y-2">
              {shippingOptions.length > 0 ? (
                shippingOptions.map((option) => (
                  <label
                    key={option.level}
                    className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer ${
                      shippingLevel === option.level ? 'border-coral-500 bg-coral-50' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="shipping"
                        value={option.level}
                        checked={shippingLevel === option.level}
                        onChange={(e) => setShippingLevel(e.target.value)}
                        className="accent-coral-500"
                      />
                      <div>
                        <p className="font-medium">{SHIPPING_LABELS[option.level] || option.level}</p>
                        <p className="text-xs text-gray-500">
                          Est. delivery: {new Date(option.estimatedDelivery.min).toLocaleDateString()} -{' '}
                          {new Date(option.estimatedDelivery.max).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <span className="font-medium">${option.costExclTax}</span>
                  </label>
                ))
              ) : (
                <p className="text-gray-500 text-sm">Loading shipping options...</p>
              )}
            </div>
          </div>

          {/* Price Quote */}
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-coral-500 mx-auto"></div>
              <p className="text-gray-500 mt-2">Fetching price from Lulu...</p>
            </div>
          ) : priceQuote ? (
            <div className="border-t pt-6">
              <h2 className="font-semibold text-gray-700 mb-4">Lulu Price Quote</h2>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Book</span>
                  <span>{priceQuote.bookTitle}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Pages</span>
                  <span>{priceQuote.pageCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Quantity</span>
                  <span>{priceQuote.quantity}</span>
                </div>
                <div className="border-t my-3"></div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Print Cost</span>
                  <span>${priceQuote.costs.printCost}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Shipping</span>
                  <span>${priceQuote.costs.shippingCost}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal</span>
                  <span>${priceQuote.costs.subtotal}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Tax</span>
                  <span>${priceQuote.costs.tax}</span>
                </div>
                <div className="border-t my-3"></div>
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span>${priceQuote.costs.total} {priceQuote.costs.currency}</span>
                </div>
              </div>
            </div>
          ) : null}

          {/* Action Buttons */}
          <div className="mt-8 space-y-3">
            <button
              onClick={handleSimulatePayment}
              disabled={!priceQuote || submitting}
              className="w-full py-3 px-4 bg-coral-500 text-white font-semibold rounded-lg hover:bg-coral-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Processing...' : 'Simulate Payment & Create Order'}
            </button>

            <p className="text-xs text-gray-500 text-center">
              This will create a test order and generate PDFs.
              To actually submit to Lulu sandbox, uncomment the submit code.
            </p>
          </div>

          {/* Order Created */}
          {orderCreated && (
            <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-700 font-medium">Order Created Successfully!</p>
              <p className="text-sm text-green-600 mt-1">Order ID: {orderCreated}</p>
            </div>
          )}
        </div>

        {/* Debug Info */}
        <div className="mt-6 p-4 bg-gray-100 rounded-lg">
          <h3 className="font-semibold text-gray-700 mb-2">Debug Info</h3>
          <pre className="text-xs text-gray-600 overflow-auto">
            {JSON.stringify({ bookId, quantity, shippingLevel }, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default function DummyCheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-coral-500"></div>
        </div>
      }
    >
      <DummyCheckoutContent />
    </Suspense>
  );
}
