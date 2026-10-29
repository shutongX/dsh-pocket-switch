package com.shutongx.dshphone;

import android.os.Message;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

/**
 * 接管 window.open / target=_blank：在当前 WebView 里打开。
 * 独立成顶层类是有原因的——匿名内部类编出来的 class 会让 d8 8.2.2 抛 NPE。
 */
final class ChromeClientBridge extends WebChromeClient {

    @Override
    public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
        WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
        transport.setWebView(view);
        resultMsg.sendToTarget();
        return true;
    }
}
