#include <stdlib.h>

extern int __VERIFIER_nondet_int(void);

struct node {
    struct node *next;
    int data;
};

/* build a list of unknown length */
struct node *create(void)
{
    struct node *head = NULL;
    while (__VERIFIER_nondet_int()) {
        struct node *n = malloc(sizeof *n);
        if (!n)
            abort();
        n->next = head;
        n->data = 0;
        head = n;
    }
    return head;
}

void destroy(struct node *p)
{
    while (p) {
        free(p);
        p = p->next;
    }
}

int main(void)
{
    destroy(create());
    return 0;
}
