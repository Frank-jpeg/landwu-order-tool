package com.landwu.mobile;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final String LANDWU_URL = "https://user.landwu.com/";
    private static final String SCRIPT_ASSET = "landwu-mobile.user.js";

    private WebView webView;
    private ProgressBar progressBar;
    private String mobileScript;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);

        root.addView(
                webView,
                new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        root.addView(
                progressBar,
                new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3))
        );
        setContentView(root);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, true);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUserAgentString(settings.getUserAgentString() + " LandwuMobileOrderTool/1.0");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        mobileScript = readAssetText(SCRIPT_ASSET);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (isLandwuUrl(url)) {
                    new Handler(Looper.getMainLooper()).postDelayed(() -> injectMobileScript(view), 450);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    return false;
                }
                return true;
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl(LANDWU_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    private boolean isLandwuUrl(String url) {
        try {
            String host = Uri.parse(url).getHost();
            return host != null && host.endsWith("landwu.com");
        } catch (Exception error) {
            return false;
        }
    }

    private void injectMobileScript(WebView target) {
        if (mobileScript == null || mobileScript.isEmpty()) {
            Toast.makeText(this, "手机版做单器脚本为空", Toast.LENGTH_SHORT).show();
            return;
        }
        String js = "(function(){var code=" + JSONObject.quote(mobileScript) + ";(0,eval)(code);})();";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            target.evaluateJavascript(js, null);
        } else {
            target.loadUrl("javascript:" + js);
        }
    }

    private String readAssetText(String name) {
        try (InputStream input = getAssets().open(name); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        } catch (IOException error) {
            Toast.makeText(this, "读取内置脚本失败：" + error.getMessage(), Toast.LENGTH_LONG).show();
            return "";
        }
    }

    private int dp(int value) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }
}
