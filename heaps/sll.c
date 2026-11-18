#include <stdlib.h>

extern int __VERIFIER_nondet_int(void);
extern void __VERIFIER_plot(const char *name, ...);

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
        struct node *next = p->next;
        free(p);
        p = next;
    }
}

int main(void)
{
    struct node *list = create();
    __VERIFIER_plot("sll");
    destroy(list);
    return 0;
}
