package com.readiz.music;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;

/** Initial web shell. Native Media3 background playback is the next app milestone. */
public final class MainActivity extends ComponentActivity {
    private static final String ORIGIN = "https://music.readiz.com/";
    private WebView webView;
    private LinearLayout root;
    private LinearLayout errorView;

    @SuppressLint("SetJavaScriptEnabled") // Required by the trusted same-origin player; no native bridge.
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(14, 22, 33));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(14, 22, 33));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " ReadizMusic/0.1.0");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return navigate(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return navigate(Uri.parse(url));
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError();
            }
            // Default SSL handling cancels invalid certificates. Never override it with proceed().
        });
        root.addView(webView, new LinearLayout.LayoutParams(-1, -1));
        webView.loadUrl(ORIGIN);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    private boolean navigate(Uri uri) {
        if ("https".equals(uri.getScheme()) && "music.readiz.com".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null) return false;
        if ("https".equals(uri.getScheme())) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
            catch (ActivityNotFoundException ignored) { /* No external browser installed. */ }
        }
        return true;
    }

    private void showError() {
        if (errorView != null) return;
        webView.setVisibility(android.view.View.GONE);
        errorView = new LinearLayout(this);
        errorView.setOrientation(LinearLayout.VERTICAL);
        errorView.setPadding(32, 48, 32, 32);
        TextView message = new TextView(this);
        message.setText("음악에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.");
        message.setTextColor(Color.WHITE);
        errorView.addView(message);
        Button retry = new Button(this);
        retry.setText("다시 열기");
        retry.setOnClickListener(view -> {
            root.removeView(errorView);
            errorView = null;
            webView.setVisibility(android.view.View.VISIBLE);
            webView.loadUrl(ORIGIN);
        });
        errorView.addView(retry);
        root.addView(errorView);
    }

    @Override public void onDestroy() {
        root.removeView(webView);
        webView.destroy();
        super.onDestroy();
    }
}
