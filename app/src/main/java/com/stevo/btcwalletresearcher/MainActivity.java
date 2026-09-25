package com.stevo.btcwalletresearcher;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public class MainActivity extends Activity {
    private WebView webView;

    private static final Set<String> ALLOWED_HOSTS = new HashSet<>(Arrays.asList(
            "mempool.space",
            "blockstream.info",
            "api.blockchair.com",
            "api.coinpaprika.com"
    ));

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
        settings.setUserAgentString(settings.getUserAgentString() + " CryptoClaimWalletResearcher/4.0");

        webView.addJavascriptInterface(new NativeBridge(), "Android");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                String v4 = readAsset("v4.js");
                if (v4 != null && !v4.isEmpty()) {
                    view.evaluateJavascript(v4, null);
                }
            }
        });

        String html = readAsset("index.html");
        webView.loadDataWithBaseURL(
                "https://btc-wallet-researcher.local/",
                html,
                "text/html",
                "UTF-8",
                null
        );
    }

    public class NativeBridge {
        @JavascriptInterface
        public void getJson(final String urlString, final String requestId) {
            new Thread(() -> performPublicGet(urlString, requestId)).start();
        }

        @JavascriptInterface
        public void httpRequest(final String method,
                                final String urlString,
                                final String body,
                                final String accessToken,
                                final String requestId) {
            new Thread(() -> performBackendRequest(method, urlString, body, accessToken, requestId)).start();
        }

        @JavascriptInterface
        public void openUrl(String urlString) {
            try {
                Uri uri = Uri.parse(urlString);
                String scheme = uri.getScheme();
                if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return;
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                startActivity(intent);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void shareText(String text) {
            try {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(send, "Share public research"));
            } catch (Exception ignored) {
            }
        }
    }

    private void performPublicGet(String urlString, String requestId) {
        HttpURLConnection connection = null;
        try {
            URI uri = URI.create(urlString);
            String host = uri.getHost();
            if (host == null || !ALLOWED_HOSTS.contains(host.toLowerCase())) {
                sendLegacyNetworkResult(requestId, false, 0, "Host is not allowed by this app");
                return;
            }
            if (!"https".equalsIgnoreCase(uri.getScheme())) {
                sendLegacyNetworkResult(requestId, false, 0, "Only HTTPS requests are allowed");
                return;
            }

            connection = (HttpURLConnection) new URL(urlString).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(20000);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/json,text/plain,*/*");
            connection.setRequestProperty("User-Agent", "CryptoClaimWalletResearcher/4.0");

            int status = connection.getResponseCode();
            InputStream input = status >= 200 && status < 400
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            String responseBody = readText(input);
            boolean ok = status >= 200 && status < 300;
            sendLegacyNetworkResult(requestId, ok, status, responseBody);
        } catch (Exception e) {
            sendLegacyNetworkResult(requestId, false, 0,
                    e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage()));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void performBackendRequest(String method,
                                       String urlString,
                                       String body,
                                       String accessToken,
                                       String requestId) {
        HttpURLConnection connection = null;
        try {
            String normalizedMethod = method == null ? "GET" : method.trim().toUpperCase();
            if (!"GET".equals(normalizedMethod) && !"POST".equals(normalizedMethod)) {
                sendV4NetworkResult(requestId, false, 0, "Only GET and POST are allowed");
                return;
            }

            URI uri = URI.create(urlString);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
                sendV4NetworkResult(requestId, false, 0, "Backend URL must use HTTPS");
                return;
            }

            connection = (HttpURLConnection) new URL(urlString).openConnection();
            connection.setRequestMethod(normalizedMethod);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(90000);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "CryptoClaimWalletResearcher/4.0");

            if (accessToken != null && !accessToken.trim().isEmpty()) {
                connection.setRequestProperty("X-App-Token", accessToken.trim());
            }

            if ("POST".equals(normalizedMethod)) {
                byte[] payload = (body == null ? "{}" : body).getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(payload.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload);
                }
            }

            int status = connection.getResponseCode();
            InputStream input = status >= 200 && status < 400
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            String responseBody = readText(input);
            boolean ok = status >= 200 && status < 300;
            sendV4NetworkResult(requestId, ok, status, responseBody);
        } catch (Exception e) {
            sendV4NetworkResult(requestId, false, 0,
                    e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage()));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void sendLegacyNetworkResult(String requestId, boolean ok, int status, String body) {
        final String js = "window.NativeNet && window.NativeNet._resolve(" +
                JSONObject.quote(requestId) + "," +
                (ok ? "true" : "false") + "," +
                status + "," +
                JSONObject.quote(body == null ? "" : body) + ");";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    private void sendV4NetworkResult(String requestId, boolean ok, int status, String body) {
        final String js = "window.V4Net && window.V4Net._resolve(" +
                JSONObject.quote(requestId) + "," +
                (ok ? "true" : "false") + "," +
                status + "," +
                JSONObject.quote(body == null ? "" : body) + ");";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    private String readText(InputStream input) throws Exception {
        if (input == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) out.write(buffer, 0, count);
        input.close();
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private String readAsset(String name) {
        StringBuilder out = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(getAssets().open(name)))) {
            String line;
            while ((line = reader.readLine()) != null) out.append(line).append('\n');
        } catch (Exception e) {
            return "";
        }
        return out.toString();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
