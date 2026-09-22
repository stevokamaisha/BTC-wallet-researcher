package com.stevo.btcwalletresearcher;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebChromeClient(new WebChromeClient());

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();

                if (url.startsWith("https://mempool.space/api/")) {
                    try {
                        return proxyMempoolRequest(url);
                    } catch (Exception e) {
                        return jsonErrorResponse();
                    }
                }

                return super.shouldInterceptRequest(view, request);
            }
        });

        String html = readAsset("index.html");

        webView.loadDataWithBaseURL(
                "https://mempool.space/",
                html,
                "text/html",
                "UTF-8",
                null
        );
    }

    private WebResourceResponse proxyMempoolRequest(String urlString) throws Exception {
        HttpURLConnection connection =
                (HttpURLConnection) new URL(urlString).openConnection();

        connection.setRequestMethod("GET");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "BTCWalletResearcher/1.0");

        int status = connection.getResponseCode();

        InputStream input =
                (status >= 200 && status < 400)
                        ? connection.getInputStream()
                        : connection.getErrorStream();

        byte[] body = readAllBytes(input);

        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "no-store");

        String reason = connection.getResponseMessage();
        if (reason == null || reason.isEmpty()) {
            reason = status >= 200 && status < 400 ? "OK" : "Request failed";
        }

        return new WebResourceResponse(
                "application/json",
                "UTF-8",
                status,
                reason,
                headers,
                new ByteArrayInputStream(body)
        );
    }

    private WebResourceResponse jsonErrorResponse() {
        byte[] body = "{\"error\":\"Unable to contact blockchain API\"}"
                .getBytes(StandardCharsets.UTF_8);

        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "no-store");

        return new WebResourceResponse(
                "application/json",
                "UTF-8",
                502,
                "Blockchain API unavailable",
                headers,
                new ByteArrayInputStream(body)
        );
    }

    private byte[] readAllBytes(InputStream input) throws Exception {
        if (input == null) {
            return new byte[0];
        }

        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;

        while ((count = input.read(buffer)) != -1) {
            output.write(buffer, 0, count);
        }

        input.close();
        return output.toByteArray();
    }

    private String readAsset(String name) {
        StringBuilder out = new StringBuilder();

        try (BufferedReader reader =
                     new BufferedReader(
                             new InputStreamReader(getAssets().open(name))
                     )) {

            String line;
            while ((line = reader.readLine()) != null) {
                out.append(line).append('\n');
            }

        } catch (Exception e) {
            return "<html><body><h3>Unable to load application.</h3><pre>"
                    + e.getMessage()
                    + "</pre></body></html>";
        }

        return out.toString();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
