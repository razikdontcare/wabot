/**
 * Quick test to verify fetch client is working
 * Run with: bun run test-fetch.ts
 */

import {createFetchClient} from './src/shared/utils/fetchClient.js';
import {log} from './src/infrastructure/config/config.js';

async function testFetchClient() {
    log.info('Testing FetchClient...');

    // Test 1: Basic GET request
    try {
        const client = createFetchClient({
            baseURL: 'https://jsonplaceholder.typicode.com',
            timeout: 5000,
        });

        const response = await client.get('/posts/1');
        log.info('✅ Test 1 passed: Basic GET request', response.data);
    } catch (error) {
        log.error('❌ Test 1 failed:', error);
    }

    // Test 2: GET with query params
    try {
        const client = createFetchClient({
            baseURL: 'https://jsonplaceholder.typicode.com',
            timeout: 5000,
        });

        const response = await client.get('/posts', {
            params: {userId: 1}
        });
        log.info(`✅ Test 2 passed: GET with params (${response.data.length} posts)`);
    } catch (error) {
        log.error('❌ Test 2 failed:', error);
    }

    // Test 3: POST request
    try {
        const client = createFetchClient({
            baseURL: 'https://jsonplaceholder.typicode.com',
            timeout: 5000,
        });

        const response = await client.post('/posts', {
            title: 'Test',
            body: 'Test body',
            userId: 1
        });
        log.info('✅ Test 3 passed: POST request', response.data);
    } catch (error) {
        log.error('❌ Test 3 failed:', error);
    }

    // Test 4: Timeout handling
    try {
        const client = createFetchClient({
            baseURL: 'https://httpbin.org',
            timeout: 100, // Very short timeout
        });

        await client.get('/delay/5');
        log.error('❌ Test 4 failed: Should have timed out');
    } catch (error: any) {
        if (error.code === 'ECONNABORTED') {
            log.info('✅ Test 4 passed: Timeout handling works');
        } else {
            log.error('❌ Test 4 failed: Wrong error type', error);
        }
    }

    // Test 5: ArrayBuffer response
    try {
        const client = createFetchClient({
            baseURL: 'https://cdn.razik.net',
            timeout: 10000,
        });

        const response = await client.get('/media/dp.jpg', {
            responseType: 'arraybuffer'
        });
        const buffer = Buffer.from(response.data);
        log.info(`✅ Test 5 passed: ArrayBuffer response (${buffer.length} bytes)`);
    } catch (error) {
        log.error('❌ Test 5 failed:', error);
    }

    log.info('All tests completed!');
}

testFetchClient().catch(console.error);

