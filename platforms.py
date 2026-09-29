from __future__ import annotations


PLATFORMS = {
    "boss": {
        "id": "boss",
        "name": "Boss 直聘",
        "status": "available",
        "implemented": True,
        "homeUrl": "https://www.zhipin.com/web/geek/job",
        "requiredJobFields": ["title", "company", "detail"],
        "companyExtraction": {
            "listSelectors": [".boss-name", ".job-card-footer .boss-info .boss-name"],
            "detailSelectors": [".job-boss-info a[href*='/gongsi/']", ".job-detail-company .company-name"],
            "structuredFields": ["hiringOrganization.name", "brandComInfo.brandName"],
        },
        "capabilities": {
            "search": True,
            "companyName": True,
            "greeting": True,
            "initialAttachment": False,
            "pdfResume": False,
            "imageMessage": False,
            "platformResume": True,
            "messagePolling": True,
        },
        "note": "已接入现有 Tampermonkey 执行器；附件能力以 Boss 页面实际入口为准。",
    },
    "zhaopin": {
        "id": "zhaopin",
        "name": "智联招聘",
        "status": "available",
        "implemented": True,
        "manualConfirmationRequired": True,
        "homeUrl": "https://www.zhaopin.com/",
        "requiredJobFields": ["title", "company", "detail"],
        "companyExtraction": {
            "listSelectors": [
                ".job-card__company-name",
                ".job-card__company-name--link",
                ".iteminfo__line1__compname__name",
                "[ka^='search-list_company_']",
                ".company-name",
            ],
            "detailSelectors": [
                ".job-detail-summary__company-name",
                ".job-company-info__name",
                "a[href*='company.zhaopin.com']",
                "[class*='company-name']",
                "[class*='companyName']",
            ],
            "structuredFields": ["hiringOrganization.name", "company.name", "companyName"],
        },
        "capabilities": {
            "search": True,
            "companyName": True,
            "greeting": True,
            "initialAttachment": False,
            "pdfResume": False,
            "imageMessage": False,
            "platformResume": False,
            "messagePolling": False,
        },
        "note": "搜索、公司、详情和自动沟通已完成真实页面校准；智联网页端未提供可校准的回复列表和简历工具栏，后续消息与附件不会伪报成功。",
    },
    "job51": {
        "id": "job51",
        "name": "前程无忧",
        "status": "needs_calibration",
        "implemented": False,
        "homeUrl": "https://www.51job.com/",
        "requiredJobFields": ["title", "company", "detail"],
        "companyExtraction": {
            "listSelectors": [".joblist-item .cname", ".cname", "a.comp"],
            "detailSelectors": [
                "a[href*='.51job.com'][class*='company']",
                "[class*='company-name']",
                ".com_name",
            ],
            "structuredFields": ["hiringOrganization.name", "company.name", "companyName"],
        },
        "capabilities": {
            "search": False,
            "companyName": False,
            "greeting": False,
            "initialAttachment": False,
            "pdfResume": False,
            "imageMessage": False,
            "platformResume": False,
            "messagePolling": False,
        },
        "note": "统一接口已预留；需要登录后的真实页面结构与发送流程联调。",
    },
}


def list_platforms() -> list[dict]:
    return list(PLATFORMS.values())
