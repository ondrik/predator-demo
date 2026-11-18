#include <stdlib.h>
#include <string.h>

extern int __VERIFIER_nondet_int(void);

struct request {
    char *body;
    size_t len;
};

/* on failure, releases the body and returns -1 */
int parse(struct request *req)
{
    if (__VERIFIER_nondet_int()) {
        free(req->body);
        req->body = NULL;
        return -1;
    }
    req->body[0] = '\0';
    return 0;
}

int handle(void)
{
    struct request req;
    req.len = 128;
    req.body = malloc(req.len);
    if (!req.body)
        return -1;

    int rc = parse(&req);
    free(req.body);
    return rc;
}

int main(void)
{
    return handle() ? 1 : 0;
}
