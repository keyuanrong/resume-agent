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
            "platformResume": False,
            "messagePolling": True,
        },
        "note": "已接入现有 Tampermonkey 执行器；产品只筛选并发送首次招呼，不处理回复或自动发送简历。",
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
            "initialAttachment": True,
            "pdfResume": False,
            "imageMessage": False,
            "platformResume": True,
            "messagePolling": False,
        },
        "note": "搜索、公司、详情已完成真实页面校准；自动模式只点击立即投递，由智联发送默认招呼语和当前平台简历。产品不处理后续回复，也不额外上传或追发简历。",
    },
    "job51": {
        "id": "job51",
        "name": "前程无忧",
        "status": "available",
        "implemented": True,
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
            "search": True,
            "companyName": True,
            "greeting": False,
            "initialAttachment": False,
            "pdfResume": False,
            "imageMessage": False,
            "platformResume": True,
            "messagePolling": False,
        },
        "note": "搜索、公司、岗位 ID 和完整 JD 使用浏览器登录态接口；自动模式点击岗位卡片的投递按钮并使用前程无忧平台简历，不额外发送招呼语或附件。",
    },
}


def list_platforms() -> list[dict]:
    return list(PLATFORMS.values())
