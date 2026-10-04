# Security Policy

## Supported Versions

Security updates are provided for the latest released version of this application.

| Version        | Supported          |
| -------------- | ------------------ |
| Latest release | :white_check_mark: |
| Older releases | :x:                |

## Reporting a Vulnerability

Security is a priority for this project, especially because the application may handle sensitive financial information.

If you discover a security vulnerability, please **do not report it through a public GitHub issue**.

Instead, report the vulnerability privately by contacting the project maintainer through the contact information provided in the repository.

Please include, when possible:

* A clear description of the vulnerability
* The affected component, endpoint, or feature
* Steps to reproduce the issue
* The potential security impact
* Any relevant logs, screenshots, or proof of concept
* A suggested remediation, if available

Please avoid including real financial information, credentials, API keys, personal data, or other sensitive information in your report.

## What to Report

Examples of security issues that should be reported privately include:

* Authentication or authorization bypasses
* Broken access control
* Exposure of financial or personal data
* SQL injection or other injection vulnerabilities
* Cross-site scripting (XSS)
* Cross-site request forgery (CSRF)
* Insecure API endpoints
* Sensitive information disclosure
* Improper handling of authentication tokens or secrets
* Insecure file uploads or downloads
* Vulnerabilities that could allow unauthorized modification of financial data
* Dependency vulnerabilities with a significant security impact

## Response Process

After receiving a vulnerability report, the maintainer will:

1. Acknowledge receipt of the report.
2. Review and validate the reported vulnerability.
3. Assess its severity and potential impact.
4. Develop and test an appropriate fix.
5. Release a security update when necessary.
6. Communicate the resolution to the reporter when appropriate.

Please allow reasonable time for investigation and remediation before publicly disclosing a vulnerability.

## Responsible Disclosure

Please give the project maintainers a reasonable opportunity to investigate and address a vulnerability before publicly disclosing it.

Security researchers are expected to act in good faith and avoid:

* Accessing or modifying data belonging to other users
* Disrupting the availability of the application
* Performing denial-of-service attacks
* Social engineering attacks
* Accessing credentials, tokens, or other secrets that are not their own
* Testing against production systems without authorization

## Sensitive Data

Never include real user data, financial information, passwords, API keys, authentication tokens, or other secrets in:

* GitHub issues
* Pull requests
* Public repositories
* Test cases
* Logs
* Screenshots
* Bug reports

Use synthetic or anonymized data when demonstrating security issues.

## Dependency Security

Project dependencies should be regularly reviewed and updated.

Known vulnerabilities in third-party dependencies should be assessed based on their actual impact on the application before remediation is prioritized.

## Security Best Practices for Contributors

Contributors should:

* Never commit secrets or credentials to the repository.
* Use environment variables or a secure secret-management solution for sensitive configuration.
* Validate and sanitize untrusted input.
* Follow the principle of least privilege.
* Avoid logging sensitive financial or personal information.
* Keep dependencies reasonably up to date.
* Include security-focused tests when introducing security-sensitive functionality.

## Scope

This security policy applies to the application code and configuration contained within this repository.

Third-party services, infrastructure, dependencies, and external systems are outside the direct control of this project. Vulnerabilities specific to those services should be reported to their respective maintainers or providers.

## Acknowledgements

We appreciate responsible security researchers and contributors who help improve the security of this project.
