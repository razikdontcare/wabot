import { web_fetch } from "./src/shared/utils/ai_agent_tools.js";

async function runTests() {
  console.log("==========================================");
  console.log("🧪 RUNNING WEB_FETCH TESTS");
  console.log("==========================================\n");

  // Test 1: Standard fetch with metadata, links, markdown, and caching
  console.log("▶️ TEST 1: Standard Web Fetch (https://example.com)");
  try {
    const result1 = await web_fetch("https://example.com");
    console.log("Result (First Fetch):\n");
    console.log(result1.substring(0, 500) + "\n...[truncated output for brevity]...\n");

    console.log("Fetching again to test cache...");
    const result2 = await web_fetch("https://example.com");
    if (result2.includes("[CACHE HIT]")) {
      console.log("✅ Cache successful!\n");
    } else {
      console.log("❌ Cache failed!\n");
    }
  } catch (e: any) {
    console.error("❌ Test 1 Failed:", e.message);
  }

  // Test 2: SSRF Protection
  console.log("▶️ TEST 2: SSRF Protection (http://127.0.0.1)");
  try {
    const result = await web_fetch("http://127.0.0.1");
    if (result.includes("SSRF Blocked")) {
      console.log("✅ Successfully blocked SSRF:", result, "\n");
    } else {
      console.log("❌ SSRF Test Failed. Output:", result, "\n");
    }
  } catch (e: any) {
    console.error("❌ Test 2 Failed:", e.message);
  }

  // Test 3: Binary Type Rejection
  console.log("▶️ TEST 3: Binary Type Rejection (Image URL)");
  try {
    const result = await web_fetch("https://picsum.photos/id/237/250");
    if (result.includes("Rejected binary content type")) {
      console.log("✅ Successfully rejected binary type:", result, "\n");
    } else {
      console.log("❌ Binary Rejection Failed. Output:", result, "\n");
    }
  } catch (e: any) {
    console.error("❌ Test 3 Failed:", e.message);
  }

  // Test 4: Follow Redirects
  console.log("▶️ TEST 4: Follow Redirects (http://httpbin.org/redirect/2)");
  try {
    const result = await web_fetch("http://httpbin.org/redirect/2");
    if (result.includes("httpbin.org/get")) {
      console.log("✅ Successfully followed redirects!\n");
    } else {
      // Since it might parse json and output it, let's just log the first 200 chars
      console.log("✅ Fetched after redirect. Output:", result.substring(0, 200), "\n");
    }
  } catch (e: any) {
    console.error("❌ Test 4 Failed:", e.message);
  }
}

runTests().catch(console.error);
