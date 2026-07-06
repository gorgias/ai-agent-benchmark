import test from "node:test";
import assert from "node:assert/strict";
import { extractRecommendedProducts } from "./product-recommendation-bars.js";

test("counts product-card names followed by prices", () => {
  const products = extractRecommendedProducts([
    {
      by: "ai",
      replyTail: "Daily 4.0 Lace Up Sneakers\n$64.95\nOur strongest overall seller is the Daily 4.0 Lace Up Sneakers.",
    },
  ]);
  assert.deepEqual(products.map((p) => p.name), ["Daily 4.0 Lace Up Sneakers"]);
});

test("counts product links as product recommendations", () => {
  const products = extractRecommendedProducts([
    {
      by: "ai",
      replyTail: "Open it here: https://shop.example.com/products/milky-must-haves-3-piece-skincare-set?variant=123",
    },
  ]);
  assert.deepEqual(products.map((p) => p.name), ["Milky Must Haves 3 Piece Skincare Set"]);
});

test("counts named top-pick recommendation phrases", () => {
  const products = extractRecommendedProducts([
    {
      by: "ai",
      replyTail: "Our top gift pick is the Fremont High Top Sneakers at $19.95 before tax.",
    },
  ]);
  assert.deepEqual(products.map((p) => p.name), ["Fremont High Top Sneakers"]);
});

test("trims recommendation tails after the product name", () => {
  const products = extractRecommendedProducts([
    {
      by: "ai",
      replyTail: "My gift pick is the Mesa Loop 30oz on the page you are viewing. Here it is: https://www.example.com",
    },
  ]);
  assert.deepEqual(products.map((p) => p.name), ["Mesa Loop 30oz"]);
});

test("trims dash-led recommendation tails after the product name", () => {
  const products = extractRecommendedProducts([
    {
      by: "ai",
      replyTail: "The gift pick is Loop Engage 2 \u2014 if you open that link, checkout will show the total.",
    },
  ]);
  assert.deepEqual(products.map((p) => p.name), ["Loop Engage 2"]);
});

test("counts product names embedded in price sentences", () => {
  const products = extractRecommendedProducts([
    {
      by: "ai",
      replyTail: "The Mesa Loop 30oz is $26.99. Standard shipping will be added at checkout.",
    },
  ]);
  assert.deepEqual(products.map((p) => p.name), ["Mesa Loop 30oz"]);
});

test("does not count generic categories as product recommendations", () => {
  const products = extractRecommendedProducts([
    {
      by: "ai",
      replyTail: "For a first timer, go with sneakers for comfort or casual shoes for everyday wear.",
    },
  ]);
  assert.deepEqual(products.map((p) => p.name), []);
});

test("does not count subscription quantities as products", () => {
  const products = extractRecommendedProducts([
    {
      by: "ai",
      replyTail: "For a gift, choose 3 products each month, or choose IPSY Extra and select 3, 6, or 12 months.",
    },
  ]);
  assert.deepEqual(products.map((p) => p.name), []);
});

test("does not count prose price lines as product cards", () => {
  const products = extractRecommendedProducts([
    {
      by: "ai",
      replyTail: "What we can confirm is: Catherine is $119. Shipping is $9.95 under $150.",
    },
  ]);
  assert.deepEqual(products.map((p) => p.name), []);
});
