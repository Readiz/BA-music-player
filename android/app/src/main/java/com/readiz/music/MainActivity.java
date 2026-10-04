package com.readiz.music;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.app.UiModeManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
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
    private boolean tvMode;
    private String startUrl;
    private LinearLayout root;
    private LinearLayout errorView;

    @SuppressLint("SetJavaScriptEnabled") // Required by the trusted same-origin player; no native bridge.
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        tvMode = ((UiModeManager) getSystemService(UI_MODE_SERVICE)).getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        startUrl = ORIGIN + (tvMode ? "?tv=1" : "");
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
        webView.setFocusableInTouchMode(true);
        webView.setOnKeyListener((view, keyCode, event) -> forwardRemoteKey(event));
        webView.setBackgroundColor(Color.rgb(14, 22, 33));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // Native TV remote events are forwarded to the hosted controller. The page
        // still starts paused; WebView must allow playback from that native callback.
        settings.setMediaPlaybackRequiresUserGesture(!tvMode);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + (tvMode ? " ReadizMusicTV/0.2.0" : " ReadizMusic/0.2.0"));
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
            @Override public void onPageFinished(WebView view, String url) {
                if (tvMode && errorView == null) view.requestFocus();
            }
            // Default SSL handling cancels invalid certificates. Never override it with proceed().
        });
        root.addView(webView, new LinearLayout.LayoutParams(-1, -1));
        webView.loadUrl(startUrl);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (tvMode && errorView == null && trusted(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()))) {
                    webView.evaluateJavascript("(function(){if(window.BAMusicRemote){window.BAMusicRemote.back();return true;}return false;})()",
                        handled -> { if (!"true".equals(handled)) finishAndRemoveTask(); });
                } else if (tvMode) finishAndRemoveTask();
                else if (webView.canGoBack()) webView.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    private boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && "music.readiz.com".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }

    private boolean navigate(Uri uri) {
        if (tvMode && "readiz-music://exit".equals(uri.toString()) && trusted(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()))) {
            finishAndRemoveTask();
            return true;
        }
        if (trusted(uri)) return false;
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
            webView.loadUrl(startUrl);
        });
        errorView.addView(retry);
        root.addView(errorView);
        retry.requestFocus();
    }

    private boolean forwardRemoteKey(KeyEvent event) {
        if (!tvMode || errorView != null || webView == null || !trusted(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()))) return false;
        String key;
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_DPAD_LEFT: key = "ArrowLeft"; break;
            case KeyEvent.KEYCODE_DPAD_RIGHT: key = "ArrowRight"; break;
            case KeyEvent.KEYCODE_DPAD_UP: key = "ArrowUp"; break;
            case KeyEvent.KEYCODE_DPAD_DOWN: key = "ArrowDown"; break;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER: key = "Enter"; break;
            case KeyEvent.KEYCODE_MEDIA_PLAY: key = "MediaPlay"; break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE: key = "MediaPause"; break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: key = "MediaPlayPause"; break;
            case KeyEvent.KEYCODE_MEDIA_STOP: key = "MediaStop"; break;
            case KeyEvent.KEYCODE_MEDIA_NEXT: key = "MediaTrackNext"; break;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: key = "MediaTrackPrevious"; break;
            case KeyEvent.KEYCODE_MEDIA_REWIND: key = "MediaRewind"; break;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: key = "MediaFastForward"; break;
            default: return false;
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            webView.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'" + key
                + "',repeat:" + (event.getRepeatCount() > 0) + ",bubbles:true,cancelable:true}));", null);
        }
        // Consume both phases so WebView does not generate a second click.
        return true;
    }

    @Override public void onDestroy() {
        root.removeView(webView);
        webView.destroy();
        super.onDestroy();
    }
}
